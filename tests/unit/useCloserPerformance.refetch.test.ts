import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Regressão ENG-USAB-2: as perf hooks (pipe_propostas/pipe_confirmacao) não tinham
// realtime nem invalidation; sem refetchInterval o TV dashboard congelava após uma
// venda. Este teste prova que o polling re-busca na cadência configurada.

const fromSpy = vi.fn((_table: string) => ({
  select: () => ({
    eq: () => Promise.resolve({ data: [], error: null }),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import {
  usePerfPipePropostas,
  usePerfPipeConfirmacao,
} from "@/modules/engagement/hooks/useCloserPerformance";

const REFETCH_INTERVAL = 30 * 1000;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function countFor(table: string) {
  return fromSpy.mock.calls.filter((c) => c[0] === table).length;
}

describe("perf hooks — refetchInterval (TV dashboard não congela)", () => {
  beforeEach(() => {
    fromSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("usePerfPipePropostas re-busca na cadência do polling", async () => {
    renderHook(() => usePerfPipePropostas(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0); // flush fetch inicial
    const initial = countFor("pipe_propostas");
    expect(initial).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(REFETCH_INTERVAL);
    expect(countFor("pipe_propostas")).toBeGreaterThan(initial);
  });

  it("usePerfPipeConfirmacao re-busca na cadência do polling", async () => {
    renderHook(() => usePerfPipeConfirmacao(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0);
    const initial = countFor("pipe_confirmacao");
    expect(initial).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(REFETCH_INTERVAL);
    expect(countFor("pipe_confirmacao")).toBeGreaterThan(initial);
  });
});
