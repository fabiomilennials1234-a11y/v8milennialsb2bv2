// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTothPreorderStore } from "../../supabase/functions/_shared/erp/toth-preorders/repository";
import { TOTH_PREORDER_PILOT_ORG_ID, type TothPreorderObservation, type TothPreorderOperation, type TothPreorderStore } from "../../supabase/functions/_shared/erp/toth-preorders/contracts";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const LEASE_TOKEN = "22222222-2222-4222-8222-222222222222";
const DEAL_ID = "33333333-3333-4333-8333-333333333333";
let leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> => ({ data: null, error: null }));
const store = createTothPreorderStore({ rpc });

function fixture(overrides: Partial<TothPreorderOperation> = {}): TothPreorderOperation {
  return {
    id: OPERATION_ID, organization_id: TOTH_PREORDER_PILOT_ORG_ID, deal_id: DEAL_ID,
    draft_revision: 2, delivery_state: "queued", commercial_state: "unknown", reconciliation_state: "not_due",
    external_id: null, approved_total: null, source_marker: null, source_order: null,
    request_snapshot: {
      schema_version: 1, id: "44444444-4444-4444-8444-444444444444", deal_id: DEAL_ID, revision: 2,
      lead_id: "55555555-5555-4555-8555-555555555555", client_id: "66666666-6666-4666-8666-666666666666",
      customer_external_id: "CLIENT-001", items: [{ product_external_id: "CAFE-1", quantity: 2 }],
      notes: "Reviewed snapshot", deal_outcome: "open", deal_value: 0, currency: "BRL",
    },
    lease_token: LEASE_TOKEN, lease_expires_at: leaseExpiresAt, ...overrides,
  };
}
const observation: TothPreorderObservation = {
  operation_id: OPERATION_ID, external_id: "ERP-1", status: "pending", source: "authoritative_lookup",
  source_marker: "marker-1", source_order: 1, approved_total: null,
};
interface RpcCase {
  name: string;
  call: (store: TothPreorderStore) => Promise<TothPreorderOperation | null | void>;
  expected: Record<string, unknown>;
}
const cases: RpcCase[] = [
  { name: "toth_claim_preorder_operation", call: (value) => value.claim(OPERATION_ID), expected: { p_operation_id: OPERATION_ID } },
  { name: "toth_mark_preorder_sending", call: (value) => value.mark_sending(OPERATION_ID, LEASE_TOKEN), expected: { p_operation_id: OPERATION_ID, p_lease_token: LEASE_TOKEN } },
  { name: "toth_record_preorder_observation", call: (value) => value.record_observation(OPERATION_ID, LEASE_TOKEN, observation), expected: { p_operation_id: OPERATION_ID, p_lease_token: LEASE_TOKEN, p_observation: observation } },
  { name: "toth_mark_preorder_uncertain", call: (value) => value.mark_uncertain(OPERATION_ID, LEASE_TOKEN, "lookup_failed"), expected: { p_operation_id: OPERATION_ID, p_lease_token: LEASE_TOKEN, p_error_code: "lookup_failed" } },
  { name: "toth_block_preorder_operation", call: (value) => value.block(OPERATION_ID, LEASE_TOKEN, "external_identity_changed"), expected: { p_operation_id: OPERATION_ID, p_lease_token: LEASE_TOKEN, p_error_code: "external_identity_changed" } },
  { name: "toth_reconcile_preorder_operation", call: (value) => value.reconcile(OPERATION_ID, LEASE_TOKEN), expected: { p_operation_id: OPERATION_ID, p_lease_token: LEASE_TOKEN } },
  { name: "toth_release_preorder_operation", call: (value) => value.release(OPERATION_ID, LEASE_TOKEN), expected: { p_operation_id: OPERATION_ID, p_lease_token: LEASE_TOKEN } },
];

beforeEach(() => {
  leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  rpc.mockReset().mockResolvedValue({ data: fixture(), error: null });
});

describe("toth preorder repository — fronteira RPC do servidor", () => {
  it.each(cases)("$name encaminha somente ID, lease e argumentos da transição", async ({ name, call, expected }) => {
    await call(store);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(name, expected);
    expect(expected).not.toHaveProperty("p_organization_id");
    expect(expected).not.toHaveProperty("p_request_snapshot");
    expect(expected).not.toHaveProperty("p_deal_id");
  });

  it("decodifica somente metadados esperados e copia snapshot congelado", async () => {
    const raw = { ...fixture(), credentials: "service-secret", provider_payload: { token: "secret" } };
    rpc.mockResolvedValue({ data: raw, error: null });
    const result = await store.claim(OPERATION_ID);
    expect(result).toEqual(fixture());
    expect(result).not.toBe(raw);
    expect(result?.request_snapshot).not.toBe(raw.request_snapshot);
    raw.request_snapshot.notes = "modified after response";
    expect(result?.request_snapshot.notes).toBe("Reviewed snapshot");
    expect(result).not.toHaveProperty("credentials");
    expect(result).not.toHaveProperty("provider_payload");
  });

  it.each(cases.filter(({ name }) => name !== "toth_release_preorder_operation"))("$name preserva null de lease perdida sem fabricar operação ou repetir RPC", async ({ call }) => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(call(store)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["outro tenant", { organization_id: "44444444-4444-4444-8444-444444444444" }],
    ["operação diferente", { id: "55555555-5555-4555-8555-555555555555" }],
    ["UUID inválido", { id: "not-a-uuid" }],
    ["revisão inválida", { draft_revision: 0 }],
    ["estado desconhecido", { delivery_state: "invalid" }],
    ["lease incompleta", { lease_expires_at: null }],
    ["aprovação sem evidência", { commercial_state: "approved", approved_total: 200 }],
    ["conciliação sem aprovação", { reconciliation_state: "complete" }],
    ["snapshot inválido", { request_snapshot: [] }],
  ])("rejeita resultado inválido do banco: %s", async (_label, fields) => {
    rpc.mockResolvedValue({ data: { ...fixture(), ...(fields as Record<string, unknown>) }, error: null });
    await expect(store.claim(OPERATION_ID)).rejects.toThrow("toth_preorder_invalid_storage_result");
  });

  it.each([undefined, "string", 1, [], {}])("rejeita resultado ausente/malformado: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(store.claim(OPERATION_ID)).rejects.toThrow("toth_preorder_invalid_storage_result");
  });

  it.each(cases)("$name não propaga mensagens SQL com dados sensíveis", async ({ call }) => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "postgres://user:password@host document 123 secret" } });
    await expect(call(store)).rejects.toThrow(/^toth_preorder_storage_failed$/);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "claim", call: () => store.claim(OPERATION_ID) },
    { name: "release", call: () => store.release(OPERATION_ID, LEASE_TOKEN) },
  ])("$name também sanitiza rejeição da Promise de transporte", async ({ call }) => {
    rpc.mockRejectedValue(new Error("connection failed postgres://user:password@host"));
    await expect(call()).rejects.toThrow(/^toth_preorder_storage_failed$/);
  });
});
