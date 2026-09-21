// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createUnavailableTothPreorderAdapter } from "../../supabase/functions/_shared/erp/toth-preorders/adapter.ts";
import {
  parseTothPreorderOperation, TOTH_PREORDER_PILOT_ORG_ID,
  type TothPreorderAdapter, type TothPreorderObservation, type TothPreorderOperation, type TothPreorderStore,
} from "../../supabase/functions/_shared/erp/toth-preorders/contracts.ts";
import { processTothPreorder, readTothPreorderObservation } from "../../supabase/functions/_shared/erp/toth-preorders/engine.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const operationId = id(1);
const clone = <T>(value: T): T => structuredClone(value);
const operation = (changes: Partial<TothPreorderOperation> = {}): TothPreorderOperation => ({
  id: operationId,
  organization_id: TOTH_PREORDER_PILOT_ORG_ID,
  deal_id: id(2),
  draft_revision: 1,
  delivery_state: "queued",
  commercial_state: "unknown",
  reconciliation_state: "not_due",
  external_id: null,
  approved_total: null,
  source_marker: null,
  source_order: null,
  request_snapshot: {
    schema_version: 1, id: id(3), deal_id: id(2), revision: 1, lead_id: id(4), client_id: id(5),
    customer_external_id: "CLIENT-001", items: [{ product_external_id: "CAFE-01", quantity: 2 }],
    notes: "Rascunho", deal_outcome: "open", deal_value: 0, currency: "BRL",
  },
  lease_token: null,
  lease_expires_at: null,
  ...changes,
});
const observation = (changes: Partial<TothPreorderObservation> = {}): TothPreorderObservation => ({
  operation_id: operationId,
  external_id: "PRE-001",
  status: "pending",
  source: "authoritative_lookup",
  source_marker: "supplier-event-1",
  source_order: 1,
  approved_total: null,
  ...changes,
});
const approved = (changes: Partial<TothPreorderObservation> = {}) => observation({
  status: "approved", source_order: 2, source_marker: "supplier-event-2", approved_total: 250, ...changes,
});

/** Test double only. Production uses service-only SQL CAS/transactions. */
class MemoryStore implements TothPreorderStore {
  row: TothPreorderOperation;
  events: string[] = [];
  sales = new Map<string, number>();
  reconcile_attempts = 0;
  fail_reconciliation = 0;
  lose_reconciliation_response = false;
  refuse_sending = false;
  private next_token = 100;

  constructor(seed = operation()) { this.row = clone(seed); }
  private owns(operation_id: string, token: string) { return operation_id === this.row.id && token === this.row.lease_token; }
  async claim(operation_id: string) {
    if (operation_id !== this.row.id || this.row.lease_token !== null) return null;
    this.row.lease_token = id(++this.next_token);
    this.row.lease_expires_at = new Date(Date.now() + 60000).toISOString();
    this.events.push("claim");
    return clone(this.row);
  }
  async mark_sending(operation_id: string, token: string) {
    if (!this.owns(operation_id, token) || this.row.delivery_state !== "queued" || this.refuse_sending) return null;
    this.row.delivery_state = "sending";
    this.events.push("sending_committed");
    return clone(this.row);
  }
  async record_observation(operation_id: string, token: string, value: TothPreorderObservation) {
    if (!this.owns(operation_id, token)) return null;
    this.events.push("observation_committed");
    if (this.row.source_order !== null && value.source_order < this.row.source_order) return clone(this.row);
    if (this.row.source_order === value.source_order) {
      if (this.row.source_marker !== value.source_marker || this.row.commercial_state !== value.status
        || this.row.approved_total !== value.approved_total) this.row.reconciliation_state = "blocked";
      return clone(this.row);
    }
    if (this.row.reconciliation_state === "blocked") return clone(this.row);
    if (this.row.reconciliation_state === "complete"
      && (value.status !== "approved" || value.approved_total !== this.row.approved_total)) {
      this.row.reconciliation_state = "blocked";
      return clone(this.row);
    }
    this.row.delivery_state = "received";
    this.row.external_id = value.external_id;
    this.row.commercial_state = value.status;
    this.row.source_marker = value.source_marker;
    this.row.source_order = value.source_order;
    this.row.approved_total = value.approved_total;
    if (value.status === "approved" && this.row.reconciliation_state !== "complete") this.row.reconciliation_state = "pending";
    return clone(this.row);
  }
  async mark_uncertain(operation_id: string, token: string, code: string) {
    if (!this.owns(operation_id, token)) return null;
    if (this.row.delivery_state === "sending" || this.row.delivery_state === "awaiting_confirmation") {
      this.row.delivery_state = "awaiting_confirmation";
    }
    this.events.push(code);
    return clone(this.row);
  }
  async block(operation_id: string, token: string, code: string) {
    if (!this.owns(operation_id, token)) return null;
    if (this.row.delivery_state === "received") this.row.reconciliation_state = "blocked";
    else this.row.delivery_state = "blocked";
    this.events.push(code);
    return clone(this.row);
  }
  async reconcile(operation_id: string, token: string) {
    if (!this.owns(operation_id, token)) return null;
    this.reconcile_attempts++;
    if (this.fail_reconciliation-- > 0) throw new Error("local database unavailable");
    if (this.row.commercial_state !== "approved" || this.row.reconciliation_state !== "pending") return clone(this.row);
    this.sales.set(operation_id, this.row.approved_total!);
    this.row.reconciliation_state = "complete";
    this.events.push("sale_committed");
    if (this.lose_reconciliation_response) {
      this.lose_reconciliation_response = false;
      throw new Error("response lost after commit");
    }
    return clone(this.row);
  }
  async release(operation_id: string, token: string) {
    if (!this.owns(operation_id, token)) return;
    this.row.lease_token = null;
    this.row.lease_expires_at = null;
    this.events.push("release");
  }
}

function setup(seed = operation()) {
  const store = new MemoryStore(seed);
  const adapter = {
    can_create: true,
    can_lookup: true,
    create: vi.fn(async (_operation: Readonly<TothPreorderOperation>): Promise<unknown> => observation({ source: "authoritative_create" })),
    lookup: vi.fn(async (_operation: Readonly<TothPreorderOperation>): Promise<unknown> => observation()),
  } satisfies TothPreorderAdapter;
  const run = (send_enabled = true) => processTothPreorder(operationId, { store, adapter, send_enabled });
  return { store, adapter, run };
}

describe("durable create and recovery", () => {
  it("commits sending with immutable reviewed snapshot before external I/O; receipt never means sale", async () => {
    const { store, adapter, run } = setup();
    adapter.create.mockImplementationOnce(async (input) => {
      expect(store.events).toEqual(["claim", "sending_committed"]);
      expect(store.row.delivery_state).toBe("sending");
      expect(input.request_snapshot).toEqual(store.row.request_snapshot);
      return observation({ source: "authoritative_create" });
    });
    expect((await run()).disposition).toBe("received");
    expect(store.row.commercial_state).toBe("pending");
    expect(store.sales.size).toBe(0);
    expect(store.reconcile_attempts).toBe(0);
  });

  it("one lease prevents concurrent workers from creating twice", async () => {
    const { adapter, run } = setup();
    let resolveCreate!: (value: unknown) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    adapter.create.mockImplementationOnce(() => {
      signalStarted();
      return new Promise((resolve) => { resolveCreate = resolve; });
    });
    const first = run();
    await started;
    expect((await run()).disposition).toBe("busy");
    resolveCreate(observation({ source: "authoritative_create" }));
    await first;
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it("failed CAS never reaches create", async () => {
    const { store, adapter, run } = setup();
    store.refuse_sending = true;
    expect((await run()).disposition).toBe("lease_lost");
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("server revalidation can block dispatch without being mistaken for a lost lease", async () => {
    const { store, adapter, run } = setup();
    vi.spyOn(store, "mark_sending").mockImplementationOnce(async () => {
      store.row.delivery_state = "blocked";
      store.row.reconciliation_state = "blocked";
      return clone(store.row);
    });
    expect(await run()).toEqual({ operation_id: operationId, disposition: "blocked", reason_code: "dispatch_preconditions_changed" });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("a lease that expires before sending confirmation reaches the worker cannot create", async () => {
    const { store, adapter } = setup();
    const started = Date.now();
    const now = vi.fn().mockReturnValueOnce(started).mockReturnValue(started + 120000);
    const result = await processTothPreorder(operationId, { store, adapter, send_enabled: true, now });
    expect(result.disposition).toBe("lease_lost");
    expect(store.row.delivery_state).toBe("sending");
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("expired claimed lease cannot reach any adapter method", async () => {
    const { store, adapter } = setup();
    const now = () => Date.now() + 120000;
    expect((await processTothPreorder(operationId, { store, adapter, send_enabled: true, now })).reason_code).toBe("invalid_claim");
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.lookup).not.toHaveBeenCalled();
  });

  it("a malformed transition response with the same token still cannot reach create", async () => {
    const { store, adapter, run } = setup();
    vi.spyOn(store, "mark_sending").mockImplementationOnce(async () => ({
      ...store.row, delivery_state: "sending", organization_id: id(999),
    }));
    expect((await run()).disposition).toBe("lease_lost");
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("timeout after possible send queries by the same operation instead of creating again", async () => {
    const { store, adapter, run } = setup();
    adapter.create.mockRejectedValueOnce(new Error("timeout after supplier commit"));
    expect((await run()).disposition).toBe("awaiting_confirmation");
    expect(store.row.delivery_state).toBe("awaiting_confirmation");
    expect((await run()).disposition).toBe("received");
    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.lookup.mock.calls[0][0].id).toBe(operationId);
  });

  it("crash after sending was committed but before I/O still permits lookup only", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "sending" }));
    adapter.lookup.mockResolvedValue(null);
    await run();
    await run();
    expect(store.row.delivery_state).toBe("awaiting_confirmation");
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.lookup).toHaveBeenCalledTimes(2);
  });

  it("failure to persist a create receipt still permits lookup only", async () => {
    const { store, adapter, run } = setup();
    vi.spyOn(store, "record_observation").mockRejectedValueOnce(new Error("database disconnected"));
    expect((await run()).reason_code).toBe("observation_persistence_failed");
    await run();
    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.lookup).toHaveBeenCalledTimes(1);
  });

  it("release failure may fail the request but cannot repeat external creation", async () => {
    const { store, adapter, run } = setup();
    vi.spyOn(store, "release").mockRejectedValueOnce(new Error("release response lost"));
    await expect(run()).rejects.toThrow("release response lost");
    expect(store.row.delivery_state).toBe("received");
    // Simulate expiry of the committed lease before a later worker claims it.
    store.row.lease_token = null;
    store.row.lease_expires_at = null;
    await run();
    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.lookup).toHaveBeenCalledTimes(1);
  });

  it("lease loss while I/O is in flight prevents stale persistence and reconciliation", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    adapter.lookup.mockImplementationOnce(async () => {
      store.row.lease_token = id(999);
      return approved();
    });
    expect((await run()).disposition).toBe("lease_lost");
    expect(store.row.lease_token).toBe(id(999));
    expect(store.sales.size).toBe(0);
  });
});

describe("authoritative commercial approval", () => {
  it.each([null, {}, [], { error: "not found" }, { status: "APROVADO" },
    observation({ status: "NORMAL" as "pending" }),
    { ...approved(), source: "simulation" }, { ...approved(), approved_total: "250.00" },
    { ...approved(), operation_id: id(900) }, { ...approved(), source_marker: "" },
    { ...approved(), source_order: -1 }, { ...approved(), source_order: Number.NaN },
    { ...approved(), approved_total: Infinity }, { ...approved(), approved_total: 0 },
    { ...approved(), approved_total: 100.001 }, { ...approved(), approved_total: 10000000000 },
    { ...approved(), external_id: "x".repeat(129) },
    { ...approved(), error: "could not validate" },
  ])("never treats missing, malformed or error JSON as approval: %j", async (raw) => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    adapter.lookup.mockResolvedValueOnce(raw);
    expect((await run()).disposition).toBe("awaiting_confirmation");
    expect(store.sales.size).toBe(0);
    expect(store.reconcile_attempts).toBe(0);
  });

  it("an approval-looking create response cannot recognize revenue without authoritative lookup", async () => {
    const { store, adapter, run } = setup();
    adapter.create.mockResolvedValueOnce(approved({ source: "authoritative_create" }));
    await run();
    expect(store.sales.size).toBe(0);
    adapter.lookup.mockResolvedValueOnce(approved());
    expect((await run()).disposition).toBe("reconciled");
    expect(store.sales.get(operationId)).toBe(250);
    expect(store.events.indexOf("observation_committed")).toBeLessThan(store.events.indexOf("sale_committed"));
  });

  it("an explicit unknown state is recorded without approving or guessing a supplier label", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    adapter.lookup.mockResolvedValueOnce(observation({ status: "unknown" }));
    await run();
    expect(store.row.commercial_state).toBe("unknown");
    expect(store.sales.size).toBe(0);
  });

  it("rejection before approval neither records a sale nor invokes reversal or a second create", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    adapter.lookup.mockResolvedValue(observation({ status: "rejected" }));
    await run();
    await run();
    expect(store.row.commercial_state).toBe("rejected");
    expect(store.reconcile_attempts).toBe(0);
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("changed external identity blocks instead of attaching another supplier order", async () => {
    const { store, adapter, run } = setup();
    await run();
    adapter.lookup.mockResolvedValueOnce(approved({ external_id: "OTHER-ORDER" }));
    expect((await run()).reason_code).toBe("external_identity_changed");
    expect(store.row.external_id).toBe("PRE-001");
    expect(store.sales.size).toBe(0);
  });
});

describe("local recovery and observation ordering", () => {
  it("failed reconciliation retries only the local transaction even with adapter and sends disabled", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    store.fail_reconciliation = 1;
    adapter.lookup.mockResolvedValueOnce(approved());
    expect((await run()).disposition).toBe("reconciliation_pending");
    expect(store.row.reconciliation_state).toBe("pending");
    expect((await processTothPreorder(operationId, { store, adapter: createUnavailableTothPreorderAdapter(), send_enabled: false })).disposition)
      .toBe("reconciled");
    expect(store.sales.size).toBe(1);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.lookup).toHaveBeenCalledTimes(1);
  });

  it("lost response after local commit and duplicate approval never create another sale", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    store.lose_reconciliation_response = true;
    adapter.lookup.mockResolvedValue(approved());
    await run();
    await run();
    expect(store.sales.size).toBe(1);
    expect(store.reconcile_attempts).toBe(1);
    expect(adapter.lookup).toHaveBeenCalledTimes(2);
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("late pending observation cannot downgrade recognized approval", async () => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    adapter.lookup.mockResolvedValueOnce(approved()).mockResolvedValueOnce(observation());
    await run();
    await run();
    expect(store.row.commercial_state).toBe("approved");
    expect(store.row.reconciliation_state).toBe("complete");
    expect(store.sales.size).toBe(1);
  });

  it.each([
    approved({ source_marker: "conflicting-event-same-position" }),
    approved({ source_order: 3, source_marker: "event-3", approved_total: 300 }),
    observation({ source_order: 3, source_marker: "event-3", status: "rejected" }),
  ])("later conflict or commercial divergence blocks without modifying the recognized sale", async (change) => {
    const { store, adapter, run } = setup(operation({ delivery_state: "awaiting_confirmation" }));
    adapter.lookup.mockResolvedValueOnce(approved()).mockResolvedValueOnce(change)
      .mockResolvedValueOnce(approved({ source_order: 4, source_marker: "reapproval-event" }));
    await run();
    expect((await run()).disposition).toBe("blocked");
    await run();
    expect(store.row.reconciliation_state).toBe("blocked");
    expect(store.sales.get(operationId)).toBe(250);
    expect(store.reconcile_attempts).toBe(1);
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("stopping new sends preserves queued work and does not stop receipt checks", async () => {
    const { store, adapter, run } = setup();
    expect((await run(false)).reason_code).toBe("writes_disabled");
    expect(store.row.delivery_state).toBe("queued");
    expect(adapter.create).not.toHaveBeenCalled();
    await run();
    await run(false);
    expect(adapter.lookup).toHaveBeenCalledTimes(1);
  });
});

describe("production adapter and RPC boundaries", () => {
  it("production adapter is unavailable and performs no network operation, including direct invocation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = createUnavailableTothPreorderAdapter();
    const store = new MemoryStore();
    expect((await processTothPreorder(operationId, { store, adapter, send_enabled: true })).reason_code)
      .toBe("supplier_contract_unverified");
    expect(await adapter.create(operation())).toEqual({ unavailable: true, reason_code: "supplier_contract_unverified" });
    expect(await adapter.lookup(operation())).toEqual({ unavailable: true, reason_code: "supplier_contract_unverified" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("flags must be true booleans; truthy values cannot enable create", async () => {
    const { store, adapter } = setup();
    expect((await processTothPreorder(operationId, { store, adapter, send_enabled: "true" as unknown as boolean })).reason_code)
      .toBe("writes_disabled");
    adapter.can_create = "true" as unknown as boolean;
    await processTothPreorder(operationId, { store, adapter, send_enabled: true });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("normalizes only valid service work items and clones the frozen snapshot", () => {
    const raw = operation();
    const parsed = parseTothPreorderOperation(raw);
    expect(parsed).toEqual(raw);
    expect(parsed?.request_snapshot).not.toBe(raw.request_snapshot);
    for (const change of [
      { id: "not-uuid" }, { organization_id: id(999) }, { deal_id: null }, { draft_revision: 0 },
      { delivery_state: "sent" }, { commercial_state: "APROVADO" }, { reconciliation_state: "done" },
      { source_marker: "event", source_order: null }, { lease_token: id(99), lease_expires_at: null },
      { approved_total: Infinity }, { request_snapshot: [] }, { request_snapshot: { amount: NaN } },
      { commercial_state: "approved" }, { reconciliation_state: "complete" },
    ]) expect(parseTothPreorderOperation({ ...raw, ...change }), JSON.stringify(change)).toBeNull();
  });

  it("invalid claimed tenant cannot reach adapter or reconciliation", async () => {
    const { store, adapter, run } = setup(operation({ organization_id: id(999) }));
    expect((await run()).reason_code).toBe("invalid_claim");
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.lookup).not.toHaveBeenCalled();
    expect(store.reconcile_attempts).toBe(0);
  });

  it("declared authoritative source must match the actual adapter method", () => {
    expect(readTothPreorderObservation(approved(), operationId, "authoritative_create")).toBeNull();
    expect(readTothPreorderObservation(observation({ source: "authoritative_create" }), operationId, "authoritative_lookup")).toBeNull();
  });

  it("requires snapshot identities, exact reviewed revision and valid product-only lines", () => {
    const raw = operation();
    for (const change of [
      { schema_version: 2 }, { id: "draft" }, { deal_id: id(50) }, { revision: 2 },
      { lead_id: null }, { client_id: "CLIENT-001" }, { customer_external_id: " " },
      { currency: "USD" }, { deal_outcome: "lost" }, { deal_value: -1 },
      { items: [] }, { items: [{ product_external_id: "CAFE-01", quantity: 0 }] },
      { items: [{ product_external_id: "CAFE-01", quantity: 2, unit_price: 100 }] },
      { items: [{ product_external_id: "CAFE-01", quantity: 2 }, { product_external_id: "CAFE-01", quantity: 3 }] },
      { notes: "x".repeat(1001) },
    ]) expect(parseTothPreorderOperation({ ...raw, request_snapshot: { ...raw.request_snapshot, ...change } }), JSON.stringify(change)).toBeNull();
  });

  it.each([0.01, 1.01, 100.99, 9999999999.99])("accepts valid BRL totals without overriding them: %s", (total) => {
    expect(readTothPreorderObservation(approved({ approved_total: total }), operationId, "authoritative_lookup")?.approved_total).toBe(total);
  });
});
