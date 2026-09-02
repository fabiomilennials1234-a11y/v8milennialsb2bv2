/**
 * Behaviour tests for useDeletePipelineStage migration guard + usePipelineStageLeadCounts.
 *
 * Root cause of "ghost stages": deleting a stage that still has leads left those
 * leads in a stage_key the Kanban no longer renders. The hook now migrates leads
 * to a chosen active stage BEFORE deactivating, and refuses to delete a non-empty
 * stage without a destination.
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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(args[0] as string),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
});

describe("useDeletePipelineStage — migration guard", () => {
  it("empty stage: deactivates without migrating", async () => {
    scenario.entryCount = 0;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await result.current.mutateAsync({ id: "s1", pipeline_type: "whatsapp", stageKey: "novo" });

    const updates = recorded.filter((r) => r.op === "update");
    // Only the pipeline_stages deactivation — no pipeline_entries migration.
    expect(updates.some((r) => r.table === "pipeline_stages")).toBe(true);
    expect(updates.some((r) => r.table === "pipeline_entries")).toBe(false);
  });

  it("non-empty stage without destination: throws and does NOT deactivate", async () => {
    scenario.entryCount = 7;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({ id: "s1", pipeline_type: "whatsapp", stageKey: "novo" }),
    ).rejects.toThrow(/7 lead/);

    const updates = recorded.filter((r) => r.op === "update");
    expect(updates.length).toBe(0); // nothing migrated, nothing deactivated
  });

  it("non-empty stage with destination: migrates leads then deactivates", async () => {
    scenario.entryCount = 7;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      id: "s1",
      pipeline_type: "whatsapp",
      stageKey: "novo",
      migrateToStageKey: "novo_lead",
    });

    const migrate = recorded.find((r) => r.op === "update" && r.table === "pipeline_entries");
    expect(migrate).toBeTruthy();
    expect((migrate!.payload as { stage_key: string }).stage_key).toBe("novo_lead");
    expect(migrate!.filters.stage_key).toBe("novo"); // moved FROM the deleted stage
    expect(migrate!.filters.pipeline_id).toBe("pipe-1");

    expect(recorded.some((r) => r.op === "update" && r.table === "pipeline_stages")).toBe(true);
  });

  it("stage referenced by active dispatch rules: throws and does NOT migrate or deactivate", async () => {
    // Interim guard (F0 funis-unificacao §4.4): stage slugs/ids feed dispatch
    // rules downstream; deleting the stage would orphan the automation.
    scenario.dispatchRuleCount = 2;
    scenario.entryCount = 7; // even with leads + destination, the rule guard wins first
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({
        id: "s1",
        pipeline_type: "whatsapp",
        stageKey: "novo",
        migrateToStageKey: "novo_lead",
      }),
    ).rejects.toThrow(/2 regra/);

    const updates = recorded.filter((r) => r.op === "update");
    expect(updates.length).toBe(0); // nothing migrated, nothing deactivated

    // The guard queried the rules scoped to org + stage + active only.
    const ruleQuery = recorded.find((r) => r.table === "pipe_dispatch_rules");
    expect(ruleQuery).toBeTruthy();
    expect(ruleQuery!.filters).toMatchObject({
      organization_id: "org-1",
      pipeline_stage_id: "s1",
      is_active: true,
    });
  });

  it("dispatch-rule check fails: blocks deletion instead of proceeding blind", async () => {
    scenario.dispatchRuleError = { message: "permission denied" };
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({ id: "s1", pipeline_type: "whatsapp", stageKey: "novo" }),
    ).rejects.toThrow(/bloqueada por segurança/i);

    expect(recorded.filter((r) => r.op === "update").length).toBe(0);
  });

  it("explicit pipelineId (custom funnel): migrates by the GIVEN id without resolving pipelines", async () => {
    // SCRUM-636: o editor único passa o id do funil — o hook serve funil
    // custom (sem família) com a mesma migração + guarda de dispatch.
    scenario.entryCount = 4;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      id: "s9",
      stageKey: "em_andamento",
      migrateToStageKey: "concluido",
      pipelineId: "custom-pipe-42",
    });

    // Não consultou `pipelines` para resolver por (org, slug, system).
    expect(recorded.some((r) => r.table === "pipelines")).toBe(false);

    const migrate = recorded.find((r) => r.op === "update" && r.table === "pipeline_entries");
    expect(migrate).toBeTruthy();
    expect(migrate!.filters.pipeline_id).toBe("custom-pipe-42");
    expect((migrate!.payload as { stage_key: string }).stage_key).toBe("concluido");

    expect(recorded.some((r) => r.op === "update" && r.table === "pipeline_stages")).toBe(true);
  });

  it("explicit pipelineId: dispatch-rule guard still fires first", async () => {
    scenario.dispatchRuleCount = 1;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({
        id: "s9",
        stageKey: "em_andamento",
        migrateToStageKey: "concluido",
        pipelineId: "custom-pipe-42",
      }),
    ).rejects.toThrow(/1 regra/);

    expect(recorded.filter((r) => r.op === "update").length).toBe(0);
  });

  it("destination equal to deleted stage: throws", async () => {
    scenario.entryCount = 3;
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({
        id: "s1",
        pipeline_type: "whatsapp",
        stageKey: "novo",
        migrateToStageKey: "novo",
      }),
    ).rejects.toThrow(/diferente/);
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
