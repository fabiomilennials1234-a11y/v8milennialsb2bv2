import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listRows: [] as unknown[],
  probeRow: null as unknown,
  insertError: null as null | { code: string; message: string },
  insertCalls: [] as Array<Record<string, unknown>>,
  rpcResult: { data: false as boolean | null },
  toastInfo: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: h.probeRow, error: null });
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: h.listRows, error: null });
    return q;
  };
  return {
    supabase: {
      from: () => ({
        select: () => query(),
        insert: async (payload: Record<string, unknown>) => {
          h.insertCalls.push(payload);
          return { error: h.insertError };
        },
      }),
      rpc: async () => h.rpcResult,
    },
  };
});
vi.mock("sonner", () => ({ toast: { info: h.toastInfo } }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: vi.fn() }));

import { findOrCreatePipelineEntry } from "./usePipelineEntries";

const params = {
  pipelineId: "pipe-1",
  leadId: "lead-1",
  organizationId: "org-1",
  stageKey: "novo",
  assignedTo: "tm-outra-pessoa",
  metadata: { sdr_id: "tm-outra-pessoa" },
};

describe("findOrCreatePipelineEntry — INSERT sem RETURNING (ADR-0042)", () => {
  beforeEach(() => {
    h.listRows = [];
    h.probeRow = null;
    h.insertError = null;
    h.insertCalls = [];
    h.rpcResult = { data: false };
    h.toastInfo.mockReset();
  });

  it("gera o id no cliente e NÃO pede RETURNING: o insert é enviado com id próprio", async () => {
    h.probeRow = { id: "x", lead_id: "lead-1", stage_key: "novo" };
    await findOrCreatePipelineEntry(params);
    expect(h.insertCalls).toHaveLength(1);
    expect(typeof h.insertCalls[0].id).toBe("string");
    expect(h.insertCalls[0]).toMatchObject({ pipeline_id: "pipe-1", lead_id: "lead-1" });
  });

  it("card visível ao criador: devolve a linha real do servidor, sem aviso", async () => {
    h.probeRow = { id: "real", lead_id: "lead-1", stage_key: "novo", stage_id: "st-1" };
    const r = await findOrCreatePipelineEntry(params);
    expect(r.created).toBe(true);
    expect(r.entry).toEqual(h.probeRow);
    expect(r.hiddenFromCreator).toBeUndefined();
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("card invisível ao criador (Funil 'só os meus'): sucesso, objeto montado do payload e aviso claro", async () => {
    h.probeRow = null;
    const r = await findOrCreatePipelineEntry(params);
    expect(r.created).toBe(true);
    expect(r.hiddenFromCreator).toBe(true);
    expect(r.entry).toMatchObject({
      id: h.insertCalls[0].id,
      lead_id: "lead-1",
      organization_id: "org-1",
      stage_key: "novo",
      assigned_to: "tm-outra-pessoa",
    });
    expect(h.toastInfo).toHaveBeenCalledWith("Card criado; ele aparece para o responsável.");
  });

  it("42501 residual vira mensagem de domínio", async () => {
    h.insertError = { code: "42501", message: "new row violates row-level security policy" };
    await expect(findOrCreatePipelineEntry(params)).rejects.toMatchObject({
      code: "42501",
      message: "Sem permissão para criar este card no funil.",
    });
  });

  it("23505 com card alheio invisível: recusa de domínio 'já está neste funil'", async () => {
    h.insertError = { code: "23505", message: "duplicate key" };
    h.rpcResult = { data: true };
    await expect(findOrCreatePipelineEntry(params)).rejects.toMatchObject({
      code: "23505",
      message: "Este lead já está neste funil, sob outro responsável.",
    });
  });

  it("23505 sem card alheio: repassa o erro original", async () => {
    h.insertError = { code: "23505", message: "duplicate key" };
    h.rpcResult = { data: false };
    await expect(findOrCreatePipelineEntry(params)).rejects.toMatchObject({ message: "duplicate key" });
  });
});
