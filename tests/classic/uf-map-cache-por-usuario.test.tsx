// CLÁSSICA — cópia de src/modules/analytics/hooks/useUfMap.test.tsx (o `@`
// resolve para classic/src).
//
// A chave do cache do mapa leva o usuário: o resultado depende de quem chama
// (a RPC aplica a visibilidade de leads — 20280111000700). Sem isso, a troca de
// conta na mesma aba serviria do cache o mapa e a lista de outra pessoa.
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const estado = vi.hoisted(() => ({ userId: "user-a" as string | null, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: unknown) => estado.rpc(fn, args) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useIdentity: () => ({ userId: estado.userId }),
}));

import { useLeadsByUf, useUfHeatmap } from "@/modules/analytics/hooks/useUfMap";

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const comCliente = (qc: QueryClient) =>
  function Provedor({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

beforeEach(() => {
  estado.userId = "user-a";
  estado.rpc.mockReset();
  estado.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data: fn === "get_uf_heatmap" ? [{ uf: "SC", leads_count: 1, clients_count: 0, total_sold: 0, unmapped_count: 0 }] : [],
      error: null,
    }),
  );
});

it("outra conta na mesma aba não recebe do cache o mapa da anterior", async () => {
  const qc = novoCliente();
  const a = renderHook(() => useUfHeatmap(), { wrapper: comCliente(qc) });
  await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
  a.unmount();

  estado.userId = "user-b";
  const b = renderHook(() => useUfHeatmap(), { wrapper: comCliente(qc) });
  await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

  // staleTime de 5 min: com a chave só por org, a 2ª conta viria do cache.
  expect(estado.rpc).toHaveBeenCalledTimes(2);
  const chaves = qc.getQueryCache().findAll({ queryKey: ["uf-heatmap"] }).map((q) => q.queryKey);
  expect(chaves).toHaveLength(2);
  expect(chaves).toEqual(expect.arrayContaining([["uf-heatmap", "org-1", "user-a"], ["uf-heatmap", "org-1", "user-b"]]));
});

it("o drawer também: a lista de um estado é por usuário", async () => {
  const qc = novoCliente();
  const a = renderHook(() => useLeadsByUf("SC"), { wrapper: comCliente(qc) });
  await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
  a.unmount();

  estado.userId = "user-b";
  const b = renderHook(() => useLeadsByUf("SC"), { wrapper: comCliente(qc) });
  await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

  expect(estado.rpc).toHaveBeenCalledTimes(2);
  expect(qc.getQueryCache().findAll({ queryKey: ["uf-leads"] }).map((q) => q.queryKey)).toEqual(
    expect.arrayContaining([["uf-leads", "org-1", "user-a", "SC"], ["uf-leads", "org-1", "user-b", "SC"]]),
  );
});

it("sem usuário identificado não busca nada", () => {
  estado.userId = null;
  const qc = novoCliente();
  renderHook(() => useUfHeatmap(), { wrapper: comCliente(qc) });
  renderHook(() => useLeadsByUf("SC"), { wrapper: comCliente(qc) });
  expect(estado.rpc).not.toHaveBeenCalled();
});
