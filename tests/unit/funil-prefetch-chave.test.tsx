/**
 * Armadilha da chave legada: o prefetch do trilho gravava em
 * `["pipeline_entries", slug, org]`, chave que tela nenhuma lia. Aqui a tela
 * REAL (`usePaginatedFunil`, com o recorte que `Funil.tsx` compõe no estado
 * inicial) e o prefetch REAL rodam contra caches separados — e as chaves têm
 * de ser idênticas, coluna por coluna, inclusive a contagem e as etapas.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

const ORG = "org-1";
const PIPE = { id: "p-1", slug: "vendas", is_active: true, type: "custom" };
const ETAPAS = [
  { id: "s1", stage_key: "novo", position: 0 },
  { id: "s2", stage_key: "proposta", position: 1 },
];

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: ETAPAS, error: null });
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: ORG, isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: ORG } }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: () => {} }));
vi.mock("@/modules/pipelines/hooks/model/useFunilRealtime", () => ({ useFunilRealtime: () => {} }));
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({ executarMoveCustom: vi.fn() }));

import { usePaginatedFunil, useFunilStages } from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import { usePrefetchPipes } from "@/modules/pipelines/hooks/perf/usePrefetchPipes";
import {
  EXTRAS_INICIAIS_DO_FUNIL,
  comporFiltrosDoFunil,
  createInitialFunilFilterState,
  paginatedFiltersDoEstado,
} from "@/modules/pipelines/lib/funil-filtros-estado";

function novoCliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const chaves = (qc: QueryClient): string[] =>
  qc
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey as QueryKey)
    .filter((k) => ["pipeline-page", "pipeline-stage-counts", "funil-stages"].includes(String(k[0])))
    // Slots fixos sem etapa (`__empty__`) existem só na tela, desabilitados.
    .filter((k) => k[2] !== "__empty__")
    .map((k) => JSON.stringify(k))
    .sort();

/** O que `Funil.tsx` compõe ao abrir (painel inicial + extras padrão, sem período/faixa). */
function filtrosDaTelaAoAbrir(donoForcado: string | null) {
  const painel = paginatedFiltersDoEstado(createInitialFunilFilterState(), "", donoForcado ?? "all");
  return comporFiltrosDoFunil(painel, { ...EXTRAS_INICIAIS_DO_FUNIL }, { closedStatusKeys: [], temPeriodo: false, timeParams: {} });
}

async function chavesDaTela(donoForcado: string | null) {
  const qc = novoCliente();
  const filtros = filtrosDaTelaAoAbrir(donoForcado);
  renderHook(
    () => {
      const { data: stages = [] } = useFunilStages(PIPE.id);
      return usePaginatedFunil(PIPE.id, stages, filtros);
    },
    { wrapper: wrap(qc) },
  );
  await waitFor(() => expect(chaves(qc).filter((k) => k.startsWith('["pipeline-page"'))).toHaveLength(ETAPAS.length));
  return chaves(qc);
}

async function chavesDoPrefetch(donoForcado: string | null) {
  const qc = novoCliente();
  qc.setQueryData(["pipelines", ORG], [PIPE]);
  const { result } = renderHook(() => usePrefetchPipes(), { wrapper: wrap(qc) });
  await act(async () => {
    await result.current({ slug: PIPE.slug, donoForcado });
  });
  return chaves(qc);
}

describe("prefetch do funil — chave igual à da tela", () => {
  it("visão Todos: etapas, contagem e cada coluna na mesma chave", async () => {
    const tela = await chavesDaTela(null);
    const prefetch = await chavesDoPrefetch(null);
    expect(prefetch).toEqual(tela);
    expect(prefetch.some((k) => k.includes('"pipeline_entries"'))).toBe(false);
  });

  it("visão Meus: o dono forçado entra no recorte dos dois lados", async () => {
    const tela = await chavesDaTela("tm-9");
    const prefetch = await chavesDoPrefetch("tm-9");
    expect(prefetch).toEqual(tela);
    expect(prefetch.join()).toContain("tm-9");
  });

  it("um aquecimento em voo por vez; funil fora do cache não aquece", async () => {
    const qc = novoCliente();
    const { result } = renderHook(() => usePrefetchPipes(), { wrapper: wrap(qc) });
    await act(async () => {
      await result.current({ slug: "inexistente", donoForcado: null });
    });
    expect(chaves(qc)).toEqual([]);

    qc.setQueryData(["pipelines", ORG], [PIPE]);
    const contagens = vi.spyOn(qc, "prefetchQuery");
    await act(async () => {
      await Promise.all([
        result.current({ slug: PIPE.slug, donoForcado: null }),
        result.current({ slug: PIPE.slug, donoForcado: null }),
      ]);
    });
    expect(contagens).toHaveBeenCalledTimes(1);
  });
});
