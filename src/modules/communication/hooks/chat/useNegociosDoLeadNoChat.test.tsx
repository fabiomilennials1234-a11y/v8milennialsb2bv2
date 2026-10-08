import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as string[],
  entradas: [] as Record<string, unknown>[],
  negocios: [] as Record<string, unknown>[],
  itens: [] as Record<string, unknown>[],
  deals: [] as Record<string, unknown>[],
  leadsDealsIds: [] as string[][],
  filters: [] as { table: string; field: string; value: unknown }[],
  failingTable: "",
  baseError: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      state.queries.push(tabela);
      const data =
        tabela === "pipeline_entries" ? state.entradas : tabela === "deals" ? state.negocios : state.itens;
      const chain = {
        select: () => chain,
        eq: (field: string, value: unknown) => {
          state.filters.push({ table: tabela, field, value });
          return chain;
        },
        in: () => chain,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({
          data: state.failingTable === tabela ? null : data,
          error: state.failingTable === tabela ? new Error("Falha de leitura") : null,
        }).then(ok),
      };
      return chain;
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-riofix" }),
  useTeamMembers: () => ({ data: [{ id: "tm-thiago", user_id: "u-thiago", name: "Thiago Assumpção" }] }),
}));
vi.mock("@/modules/leads", () => ({
  useLeadsDeals: (ids: string[]) => {
    state.leadsDealsIds.push(ids);
    return { data: ids.length ? { lead: state.deals } : undefined, isLoading: false, isError: state.baseError };
  },
  dealBoardPath: (d: { pipelineSlug: string }) => (d.pipelineSlug ? `/funil/${d.pipelineSlug}` : null),
}));

import { useNegociosDoLeadNoChat } from "./useNegociosDoLeadNoChat";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const base = {
  leadId: "lead", funnelName: "Funil Mustang", funnelColor: "#f00", pipelineSlug: "mustang",
  isSystem: false, stageName: "Negociando", outcome: "open", value: 0, daysInStage: 3,
  enteredAt: "2026-09-20T12:00:00Z",
};

beforeEach(() => {
  state.queries = [];
  state.leadsDealsIds = [];
  state.filters = [];
  state.failingTable = "";
  state.baseError = false;
  state.entradas = [
    { id: "e1", assigned_to: "u-thiago", deal_id: "d1" },
    { id: "e2", assigned_to: null, deal_id: null },
  ];
  state.negocios = [{ id: "d1", value: 1000, created_at: "2026-09-23T10:00:00Z" }];
  state.itens = [{ deal_id: "d1", total: 80000 }, { deal_id: "d1", total: 4739 }];
  state.deals = [
    { ...base, id: "e2", title: "Funil Mustang", value: 250, enteredAt: "2026-08-01T00:00:00Z" },
    { ...base, id: "e1", title: "Ricardo POSSEBON" },
  ];
});

describe("useNegociosDoLeadNoChat", () => {
  it("junta valor dos itens, dono pelo user_id e data de deals", async () => {
    const { result } = renderHook(() => useNegociosDoLeadNoChat("lead", true), { wrapper });
    await waitFor(() => expect(result.current.negocios[0]?.dono).toBe("Thiago Assumpção"));

    const [primeiro, segundo] = result.current.negocios;
    expect(primeiro).toMatchObject({
      id: "e1", titulo: "Ricardo POSSEBON", valor: 84739, criadoEm: "2026-09-23T10:00:00Z",
      etapa: "Negociando", caminho: "/funil/mustang", estado: "aberto",
    });
    // Card sem linha em `deals`: valor do funil, data de entrada, sem dono.
    expect(segundo).toMatchObject({ id: "e2", valor: 250, dono: null, criadoEm: "2026-08-01T00:00:00Z" });
  });

  it("desligado não consulta nada", () => {
    const { result } = renderHook(() => useNegociosDoLeadNoChat("lead", false), { wrapper });
    expect(result.current.negocios).toEqual([]);
    expect(state.queries).toEqual([]);
    expect(state.leadsDealsIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("filtra todas as consultas pela organização ativa", async () => {
    const { result } = renderHook(() => useNegociosDoLeadNoChat("lead", true), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBeFalsy());
    for (const table of ["pipeline_entries", "deals", "deal_items"]) {
      expect(state.filters).toContainEqual({ table, field: "organization_id", value: "org-riofix" });
    }
  });

  it("atualiza o resumo quando o editor do negócio invalida os dados", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNegociosDoLeadNoChat("lead", true), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.negocios[0]?.valor).toBe(84739));
    state.itens = [{ deal_id: "d1", total: 1200 }];
    state.entradas = [{ id: "e1", assigned_to: null, deal_id: "d1" }];
    await act(() => client.invalidateQueries({ queryKey: ["leads-deals"] }));
    await waitFor(() => expect(result.current.negocios[0]).toMatchObject({ valor: 1200, dono: null }));
  });

  it.each(["pipeline_entries", "deals", "deal_items"])("expõe falha de %s sem tratar como dado ausente", async (table) => {
    state.failingTable = table;
    const { result } = renderHook(() => useNegociosDoLeadNoChat("lead", true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("expõe falha da lista principal de negócios", async () => {
    state.baseError = true;
    const { result } = renderHook(() => useNegociosDoLeadNoChat("lead", true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
