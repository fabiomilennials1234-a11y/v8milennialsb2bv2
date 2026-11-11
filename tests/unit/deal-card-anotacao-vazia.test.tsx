import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const resposta = vi.hoisted(() => ({
  entry: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order", "limit"]) query[method] = () => query;
      query.maybeSingle = () => Promise.resolve({ data: resposta.entry, error: resposta.error });
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return query;
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", role: "member" }),
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/engagement", () => ({ useLeadChecklists: () => ({ data: [] }) }));
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadDetail", () => ({
  useLeadDetail: () => ({ lead: { id: "lead-1", name: "Cliente" }, isLoading: false }),
}));
vi.mock("@/modules/leads/hooks/useLeadsDeals", () => ({
  useLeadsDeals: () => ({ data: { "lead-1": [{ id: "entry-1", pipelineId: "pipe-1", stageKey: "novo" }] } }),
}));
vi.mock("@/modules/leads/components/lead-card/useProdutosPorNegocio", () => ({ useProdutosPorNegocio: () => ({ data: {} }) }));
vi.mock("@/modules/leads/hooks/useLeadsSalesMetrics", () => ({ useLeadsSalesMetrics: () => ({ data: {} }) }));
vi.mock("@/modules/leads/hooks/useLeadsCarteiraMetrics", () => ({ useLeadsCarteiraMetrics: () => ({ data: {} }) }));
vi.mock("@/modules/leads/hooks/useOrgUsaLeiDoErp", () => ({ useOrgUsaLeiDoErp: () => ({ usaLeiDoErp: false }) }));

import { useDealCardData } from "@/modules/leads/components/deal-card/useDealCardData";

describe("anotação do negócio: vazio não é erro de leitura", () => {
  it.each([
    { label: "NULL do banco permite a primeira anotação", entry: { id: "entry-1", notes: null }, error: null, nota: "", indisponivel: false },
    { label: "texto vazio continua editável", entry: { id: "entry-1", notes: "" }, error: null, nota: "", indisponivel: false },
    { label: "preserva uma anotação existente", entry: { id: "entry-1", notes: "Retornar amanhã" }, error: null, nota: "Retornar amanhã", indisponivel: false },
    { label: "entrada não visível por RLS permanece bloqueada", entry: null, error: null, nota: "", indisponivel: true },
    { label: "erro de leitura não permite sobrescrever dados", entry: null, error: { message: "read failed" }, nota: "", indisponivel: true },
    { label: "projeção sem notes não é anotação vazia", entry: { id: "entry-1" }, error: null, nota: "", indisponivel: true },
  ])("$label", async ({ entry, error, nota, indisponivel }) => {
    resposta.entry = entry;
    resposta.error = error;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, unmount } = renderHook(() => useDealCardData("entry-1", "lead-1", true), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(client.getQueryState(["deal-card-extras", "entry-1", "pipe-1", "novo"])?.status).toBe("success"));
    expect(result.current.data?.nota).toBe(nota);
    expect(result.current.data?.notaIndisponivel).toBe(indisponivel);
    unmount();
    client.clear();
  });
});
