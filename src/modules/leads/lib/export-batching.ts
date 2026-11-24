import { readExportPages } from "./load-ventimais-export";

/**
 * Máximo de ids por `.in()`. Um uuid ocupa ~37 chars na URL do PostgREST;
 * 200 ids ≈ 7 KB, abaixo do limite do gateway. Acima disso a requisição
 * falha (SCRUM export de etapa grande da Chique: 2.958 leads).
 */
export const EXPORT_ID_BATCH_SIZE = 200;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Lê `fetchPage` para cada lote de ids, paginando cada lote até o fim.
 * O PostgREST corta respostas em 1.000 linhas sem avisar — por isso a
 * paginação por `range` é obrigatória, não só o lote de ids.
 */
export async function fetchByIdBatches<T>(
  ids: readonly string[],
  fetchPage: (batch: string[], from: number, to: number) => PageResult<T>,
  batchSize = EXPORT_ID_BATCH_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (const batch of chunk(ids, batchSize)) {
    rows.push(...(await readExportPages<T>((from, to) => fetchPage(batch, from, to))));
  }
  return rows;
}
