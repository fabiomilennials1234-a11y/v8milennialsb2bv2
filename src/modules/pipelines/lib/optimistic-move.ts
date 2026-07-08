import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Optimistic drag-and-drop para os boards paginados (`usePaginatedPipeline`).
 *
 * O board NÃO é uma query só: cada etapa é um `useInfiniteQuery` com chave
 * `["pipeline-page", slug, stageKey, orgId, filtersKey]` e data no formato
 * `{ pages: Entry[][], pageParams }`. As contagens das colunas vivem em
 * `["pipeline-stage-counts", slug, orgId, filtersKey]` como `Record<stage,num>`.
 *
 * Antes deste helper o move só refletia na tela quando o eco do Realtime
 * (debounce 2s) invalidava o board — o card "voltava" e congelava ~2-3s. Aqui
 * movemos o card no cache na hora e devolvemos um snapshot para rollback no erro.
 *
 * Casa por prefixo de chave (`["pipeline-page", slug]`), então TODAS as
 * variantes de filtro da etapa são ajustadas — a reconciliação no `onSettled`
 * corrige qualquer divergência de filtro que o otimismo tenha deixado passar.
 */

type CacheEntry = [QueryKey, unknown];

export interface OptimisticMoveSnapshot {
  pages: CacheEntry[];
  counts: CacheEntry[];
}

interface InfiniteData {
  pages: unknown[][];
  pageParams: unknown[];
}

function isInfinite(data: unknown): data is InfiniteData {
  return !!data && Array.isArray((data as InfiniteData).pages);
}

export function optimisticMovePipelineEntry(
  qc: QueryClient,
  opts: { slug: string; id: string; toStage: string }
): OptimisticMoveSnapshot {
  const { slug, id, toStage } = opts;
  const pageKey: QueryKey = ["pipeline-page", slug];
  const countsKey: QueryKey = ["pipeline-stage-counts", slug];

  const pageCaches = qc.getQueriesData({ queryKey: pageKey });
  const countCaches = qc.getQueriesData({ queryKey: countsKey });

  // Snapshot ANTES de qualquer escrita — clona referências para rollback fiel.
  const snapshot: OptimisticMoveSnapshot = {
    pages: pageCaches.map(([k, d]) => [k, d] as CacheEntry),
    counts: countCaches.map(([k, d]) => [k, d] as CacheEntry),
  };

  // 1) Remove o card de todas as páginas onde aparece; captura o card + origem.
  let moved: Record<string, unknown> | null = null;
  let fromStage: string | null = null;

  for (const [key, data] of pageCaches) {
    if (!isInfinite(data)) continue;
    let hit = false;
    const newPages = data.pages.map((page) => {
      const arr = page as Record<string, unknown>[];
      const idx = arr.findIndex((e) => e?.id === id);
      if (idx >= 0) {
        moved = arr[idx];
        fromStage = (key as unknown[])[2] as string;
        hit = true;
        return arr.filter((e) => e?.id !== id);
      }
      return page;
    });
    if (hit) qc.setQueryData(key, { ...data, pages: newPages });
  }

  // Card não estava em cache (coluna nunca carregada): reconciliação resolve.
  if (!moved) return snapshot;

  const movedNew = { ...(moved as Record<string, unknown>), stage_key: toStage, status: toStage };

  // 2) Insere na(s) cache(s) da etapa de destino (topo da 1ª página).
  for (const [key, data] of qc.getQueriesData({ queryKey: pageKey })) {
    if ((key as unknown[])[2] !== toStage) continue;

    if (!isInfinite(data) || data.pages.length === 0) {
      const pageParams = isInfinite(data) && data.pageParams.length ? data.pageParams : [null];
      qc.setQueryData(key, { pages: [[movedNew]], pageParams });
      continue;
    }
    const already = data.pages.some((p) => (p as Record<string, unknown>[]).some((e) => e?.id === id));
    if (already) continue;
    const [first, ...rest] = data.pages;
    qc.setQueryData(key, { ...data, pages: [[movedNew, ...(first as unknown[])], ...rest] });
  }

  // 3) Ajusta contagens: -1 na origem, +1 no destino.
  for (const [key, data] of countCaches) {
    const map = data as Record<string, number> | undefined;
    if (!map) continue;
    const next = { ...map };
    if (fromStage && typeof next[fromStage] === "number") {
      next[fromStage] = Math.max(0, next[fromStage] - 1);
    }
    next[toStage] = (typeof next[toStage] === "number" ? next[toStage] : 0) + 1;
    qc.setQueryData(key, next);
  }

  return snapshot;
}

export function rollbackPipelineEntryMove(
  qc: QueryClient,
  snapshot: OptimisticMoveSnapshot
): void {
  for (const [key, data] of snapshot.pages) qc.setQueryData(key, data);
  for (const [key, data] of snapshot.counts) qc.setQueryData(key, data);
}
