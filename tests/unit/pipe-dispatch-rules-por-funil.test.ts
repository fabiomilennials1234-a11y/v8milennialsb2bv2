/**
 * SCRUM-629 (W3) · Disparo por etapa em funil custom — contratos dos hooks.
 *
 * O que este arquivo prova (D11):
 *  1. usePipeDispatchRules com pipelineId filtra por pipeline_id (chave real);
 *     sem pipelineId mantém o filtro legado por pipe_type.
 *  2. useCreatePipeDispatchRule grava pipeline_id quando informado (funil
 *     custom) e null quando não (sistema — trigger do banco resolve).
 *  3. useSetStageDispatchEnabled escreve SÓ o boolean — o carimbo
 *     stage_dispatch_enabled_at é do servidor, nunca do cliente (corte
 *     "nunca retroativo" não confia em relógio de browser).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Chain mock (molde: tests/unit/use-custom-pipelines.test.ts)
// ---------------------------------------------------------------------------
type ChainCall = { method: string; args: unknown[] };

function createChainMock(resolvedData: unknown[] = []) {
  const calls: ChainCall[] = [];
  const chain: Record<string, any> = { __calls: calls };
  [
    "select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike",
    "order", "limit", "insert", "update", "delete", "upsert", "is",
  ].forEach((m) => {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  });
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: resolvedData, error: null }).then(resolve, reject);
  return chain;
}

let lastChains: Record<string, any[]> = {};
let nextData: Record<string, unknown[]> = {};

const mockFrom = vi.fn((table: string) => {
  const chain = createChainMock(nextData[table] ?? []);
  (lastChains[table] ??= []).push(chain);
  return chain;
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(args[0] as string),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
  },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import {
  usePipeDispatchRules,
  useCreatePipeDispatchRule,
} from "@/modules/pipelines/hooks/config/usePipeDispatchRules";
import { useSetStageDispatchEnabled } from "@/modules/pipelines/hooks/config/useStageDispatchToggle";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

function callsOf(table: string, method: string): ChainCall[] {
  return (lastChains[table] ?? []).flatMap((c) =>
    (c.__calls as ChainCall[]).filter((call) => call.method === method)
  );
}

beforeEach(() => {
  lastChains = {};
  nextData = {};
  mockFrom.mockClear();
});

describe("usePipeDispatchRules — escopo por funil (SCRUM-629)", () => {
  it("com pipelineId filtra por pipeline_id, NÃO por pipe_type", async () => {
    const { result } = renderHook(
      () => usePipeDispatchRules("meu-funil", "pipe-uuid-1"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const eqCalls = callsOf("pipe_dispatch_rules", "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["pipeline_id", "pipe-uuid-1"] });
    expect(eqCalls.some((c) => c.args[0] === "pipe_type")).toBe(false);
  });

  it("sem pipelineId mantém o filtro legado por pipe_type", async () => {
    const { result } = renderHook(() => usePipeDispatchRules("whatsapp"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const eqCalls = callsOf("pipe_dispatch_rules", "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["pipe_type", "whatsapp"] });
    expect(eqCalls.some((c) => c.args[0] === "pipeline_id")).toBe(false);
  });
});

describe("useCreatePipeDispatchRule — pipeline_id no insert", () => {
  it("grava pipeline_id quando o funil é conhecido (custom)", async () => {
    nextData["pipe_dispatch_rules"] = [{ id: "rule-1" }];
    const { result } = renderHook(() => useCreatePipeDispatchRule(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        pipe_type: "meu-funil",
        pipeline_id: "pipe-uuid-1",
        trigger_type: "lead_added",
      });
    });

    const inserts = callsOf("pipe_dispatch_rules", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      organization_id: "org-1",
      pipe_type: "meu-funil",
      pipeline_id: "pipe-uuid-1",
      trigger_type: "lead_added",
    });
  });

  it("sem pipeline_id manda null — o trigger do banco resolve (sistema)", async () => {
    nextData["pipe_dispatch_rules"] = [{ id: "rule-2" }];
    const { result } = renderHook(() => useCreatePipeDispatchRule(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        pipe_type: "whatsapp",
        trigger_type: "lead_added",
      });
    });

    const inserts = callsOf("pipe_dispatch_rules", "insert");
    expect(inserts[0].args[0]).toMatchObject({ pipe_type: "whatsapp", pipeline_id: null });
  });
});

describe("useSetStageDispatchEnabled — só o boolean sai do cliente (D11)", () => {
  it("liga escrevendo apenas stage_dispatch_enabled; o carimbo é do servidor", async () => {
    const { result } = renderHook(() => useSetStageDispatchEnabled(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ pipelineId: "pipe-uuid-1", enabled: true });
    });

    const updates = callsOf("pipelines", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ stage_dispatch_enabled: true });
    // O corte temporal NUNCA vem do cliente:
    expect(Object.keys(updates[0].args[0] as object)).not.toContain("stage_dispatch_enabled_at");

    const eqCalls = callsOf("pipelines", "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["id", "pipe-uuid-1"] });
  });

  it("desliga escrevendo apenas o boolean false", async () => {
    const { result } = renderHook(() => useSetStageDispatchEnabled(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ pipelineId: "pipe-uuid-1", enabled: false });
    });

    const updates = callsOf("pipelines", "update");
    expect(updates[0].args[0]).toEqual({ stage_dispatch_enabled: false });
  });
});
