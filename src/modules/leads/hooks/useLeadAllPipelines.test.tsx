import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failAt: -1, calls: 0 }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const index = state.calls++;
      const response = () => ({ data: [], error: index % 6 === state.failAt ? { message: "503 indisponível" } : null });
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain,
        maybeSingle: () => Promise.resolve(response()),
        then: (resolve: (value: ReturnType<typeof response>) => unknown) => Promise.resolve(response()).then(resolve),
      };
      return chain;
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "riofix" } }),
}));
vi.mock("../pipe-ops", () => ({ usePipeOps: () => ({ useCustomPipelines: () => ({ data: [] }) }) }));

import { useLeadAllPipelines } from "./useLeadAllPipelines";

beforeEach(() => { state.calls = 0; state.failAt = -1; });

describe("Funis para criar negócio", () => {
  it.each([0, 1, 2, 3, 4, 5])("não trata falha na consulta %i como ausência de negócios e permite retry", async (index) => {
    state.failAt = index;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLeadAllPipelines("lead-1"), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    state.failAt = -1;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    client.clear();
  });
});
