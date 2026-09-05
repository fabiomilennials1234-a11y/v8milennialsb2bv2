/**
 * Behaviour tests for the transactional stage deletion RPC + lead counts.
 *
 * The database owns validation, card migration, workflow deactivation and the
 * stage soft-delete in one transaction. The hook only resolves legacy system
 * pipeline identity and calls that public operation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Per-test scenario knobs + recorded calls.
const scenario: {
  entryCount: number;
  pipelineId: string | null;
  dispatchRuleCount: number;
  dispatchRuleError: { message: string } | null;
} = {
  entryCount: 0,
  pipelineId: "pipe-1",
  dispatchRuleCount: 0,
  dispatchRuleError: null,
};
const recorded: { table: string; op: string; payload?: unknown; filters: Record<string, unknown> }[] = [];

function makeChain(table: string) {
  const filters: Record<string, unknown> = {};
  let countMode = false;
  let op = "select";
  let updatePayload: unknown;

  const chain: Record<string, any> = {};
  chain.select = (_cols?: unknown, opts?: { head?: boolean; count?: string }) => {
    if (opts?.head) countMode = true;
    return chain;
  };
  chain.update = (payload: unknown) => {
    op = "update";
    updatePayload = payload;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    filters[col] = val;
    return chain;
  };
  chain.maybeSingle = () => {
    recorded.push({ table, op: "maybeSingle", filters });
    if (table === "pipelines") {
      return Promise.resolve({
        data: scenario.pipelineId ? { id: scenario.pipelineId } : null,
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  };
  chain.then = (resolve: (v: unknown) => unknown, reject?: any) => {
    recorded.push({ table, op, payload: updatePayload, filters });
    let result: unknown;
    if (op === "update") {
      result = { error: null };
    } else if (countMode) {
      // Counts are per-table: pipe_dispatch_rules feeds the interim delete
      // guard (F0 funis-unificacao); pipeline_entries feeds the lead migration.
      result =
        table === "pipe_dispatch_rules"
          ? { count: scenario.dispatchRuleCount, error: scenario.dispatchRuleError }
          : { count: scenario.entryCount, error: null };
    } else {
      result = { data: [], error: null };
    }
    return Promise.resolve(result).then(resolve, reject);
  };
  return chain;
}

const mockFrom = vi.fn((table: string) => makeChain(table));
const mockRpc = vi.fn().mockResolvedValue({
  data: {
    stage_id: "s1",
    pipeline_id: "pipe-1",
    cards: 0,
    automacoes: 0,
    regras_disparo: 0,
    cards_migrados: 0,
    automacoes_desativadas: 0,
  },
  error: null,
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(args[0] as string),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-1" } }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));

import {
  useDeletePipelineStage,
  usePipelineStageLeadCounts,
} from "@/modules/pipelines/hooks/model/usePipelineStages";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  recorded.length = 0;
  scenario.entryCount = 0;
  scenario.pipelineId = "pipe-1";
  scenario.dispatchRuleCount = 0;
  scenario.dispatchRuleError = null;
  mockFrom.mockClear();
  mockRpc.mockClear();
  mockRpc.mockResolvedValue({
    data: {
      stage_id: "s1",
      pipeline_id: "pipe-1",
      cards: 0,
      automacoes: 0,
      regras_disparo: 0,
      cards_migrados: 0,
      automacoes_desativadas: 0,
    },
    error: null,
  });
});

describe("useDeletePipelineStage — transactional RPC", () => {
  it("system funnel resolves its id and delegates the whole mutation to one RPC", async () => {
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await result.current.mutateAsync({ id: "s1", pipeline_type: "whatsapp" });

    expect(recorded.some((r) => r.table === "pipelines" && r.op === "maybeSingle")).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("delete_pipeline_stage", {
      p_stage_id: "s1",
      p_destination_stage_id: null,
    });
    expect(recorded.some((r) => r.op === "update")).toBe(false);
  });

  it("custom funnel uses the explicit id and forwards the destination stage id", async () => {
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      id: "s9",
      pipelineId: "custom-pipe-42",
      destinationStageId: "s10",
    });

    expect(recorded.some((r) => r.table === "pipelines")).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith("delete_pipeline_stage", {
      p_stage_id: "s9",
      p_destination_stage_id: "s10",
    });
  });

  it("surfaces the database rejection without client-side writes", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Etapa usada por 2 regras de disparo ativas" },
    });
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({
        id: "s1",
        pipelineId: "pipe-1",
        destinationStageId: "s2",
      }),
    ).rejects.toThrow(/2 regra/);

    expect(recorded.some((r) => r.op === "update")).toBe(false);
  });

  it("does not call the RPC when a legacy system funnel cannot be resolved", async () => {
    scenario.pipelineId = null;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({ id: "s1", pipeline_type: "whatsapp" }),
    ).rejects.toThrow(/Funil da etapa não encontrado/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("usePipelineStageLeadCounts — explicit pipelineId", () => {
  it("counts by the given id without touching pipelines", async () => {
    mockFrom.mockImplementation((table: string) => {
      const chain: Record<string, any> = {};
      ["select", "eq"].forEach((m) => (chain[m] = () => chain));
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => {
        recorded.push({ table, op: "select", filters: {} });
        return Promise.resolve(
          table === "pipeline_entries"
            ? { data: [{ stage_key: "novo" }, { stage_key: "feito" }], error: null }
            : { data: [], error: null },
        ).then(resolve);
      };
      return chain;
    });

    const { result } = renderHook(
      () => usePipelineStageLeadCounts(null, "custom-pipe-42"),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ novo: 1, feito: 1 });
    expect(recorded.some((r) => r.table === "pipelines")).toBe(false);
  });
});

describe("usePipelineStageLeadCounts", () => {
  it("tallies leads per stage_key", async () => {
    // Override the entries select to return rows for this test.
    mockFrom.mockImplementation((table: string) => {
      const chain: Record<string, any> = {};
      ["select", "eq"].forEach((m) => (chain[m] = () => chain));
      chain.maybeSingle = () => Promise.resolve({ data: { id: "pipe-1" }, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          table === "pipeline_entries"
            ? { data: [{ stage_key: "novo" }, { stage_key: "novo" }, { stage_key: "abordado" }], error: null }
            : { data: [], error: null },
        ).then(resolve);
      return chain;
    });

    const { result } = renderHook(() => usePipelineStageLeadCounts("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ novo: 2, abordado: 1 });
  });
});
