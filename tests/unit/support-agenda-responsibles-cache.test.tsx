import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useLeadResponsibles } from "@/modules/leads/hooks/useLeadResponsibles";
import { useUpdateLead } from "@/modules/leads/hooks/useLeads";

const state = vi.hoisted(() => ({
  org: "org-a", pre: "Ana" as string | null, sale: "Bruno" as string | null,
  filters: [] as Array<[string, unknown]>, tables: [] as string[], reads: 0,
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: state.org, isReady: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      state.tables.push(table);
      let updates: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain; },
        is: (key: string, value: unknown) => { state.filters.push([key, value]); return chain; },
        update: (next: Record<string, unknown>) => { updates = next; return chain; },
        maybeSingle: async () => {
          state.reads++;
          return { data: {
            pre_sale_responsible: state.pre ? { name: state.org === "org-b" ? "Org B" : state.pre } : null,
            sale_responsible: state.sale ? { name: state.sale } : null,
          }, error: null };
        },
        single: async () => {
          if ("pre_sale_responsible_id" in updates) state.pre = updates.pre_sale_responsible_id as string | null;
          if ("sale_responsible_id" in updates) state.sale = updates.sale_responsible_id as string | null;
          return { data: { id: "lead-1" }, error: null };
        },
      };
      return chain;
    },
  },
}));
beforeEach(() => {
  state.org = "org-a"; state.pre = "Ana"; state.sale = "Bruno";
  state.filters = []; state.tables = []; state.reads = 0;
});
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
describe("responsáveis atuais da Agenda", () => {
  it("mutação real invalida consulta ativa, incluindo remoção de responsável", async () => {
    const { result } = renderHook(() => ({ data: useLeadResponsibles("lead-1").data, update: useUpdateLead() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.preSaleName).toBe("Ana"));
    await act(async () => { await result.current.update.mutateAsync({ id: "lead-1", pre_sale_responsible_id: "Carla" }); });
    await waitFor(() => expect(result.current.data?.preSaleName).toBe("Carla"));
    await act(async () => { await result.current.update.mutateAsync({ id: "lead-1", sale_responsible_id: null }); });
    await waitFor(() => expect(result.current.data?.saleName).toBeNull());
    expect(state.reads).toBe(3);
    expect(state.filters).toContainEqual(["organization_id", "org-a"]);
    expect(state.filters).toContainEqual(["deleted_at", null]);
    expect(new Set(state.tables)).toEqual(new Set(["leads"]));
  });
  it("trocar organização não reutiliza responsáveis da anterior", async () => {
    const { result, rerender } = renderHook(() => useLeadResponsibles("lead-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.preSaleName).toBe("Ana"));
    state.org = "org-b"; rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.preSaleName).toBe("Org B"));
    expect(state.filters).toContainEqual(["organization_id", "org-b"]);
  });
  it("sem lead selecionado não consulta banco", () => {
    renderHook(() => useLeadResponsibles(null), { wrapper: wrapper() });
    expect(state.tables).toEqual([]);
  });
});
