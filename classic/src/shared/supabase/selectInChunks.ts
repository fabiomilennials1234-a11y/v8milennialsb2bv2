/**
 * selectInChunks — roda um `.in(coluna, ids)` do PostgREST em lotes.
 *
 * POR QUE EXISTE (incidente Goletric Pinheiros, 2026-07-31): o postgrest-js manda
 * os ids na QUERY STRING via `URLSearchParams`, que percent-encoda a vírgula como
 * `%2C` — ~39,3 bytes por uuid. O gateway do Supabase corta a URL em ~25,2 KB.
 * Medido em PROD contra `/rest/v1/pipeline_entries`:
 *
 *     n=500  →  19.677 chars  →  200 OK
 *     n=641  →  25.176 chars  →  200 OK
 *     n=642  →  25.215 chars  →  400 Bad Request
 *     n=1000 →  39.177 chars  →  400 Bad Request
 *
 * Com filtro ativo o inbox monta páginas de 1000 conversas (`FILTERED_PAGE_LIMIT`),
 * e todo `.in()` derivado da página estourava. O 400 voltava como `{ error }` — não
 * como exceção —, então o enriquecimento sumia em silêncio e o filtro do cliente
 * descartava a página inteira.
 *
 * `in.(a,b,c)` é semântica de CONJUNTO: a união dos lotes é idêntica ao lote único.
 * Só é seguro em query SEM `.order()` / `.limit()` — nesses casos o lote mudaria o
 * recorte, e aí NÃO se chunka.
 */

/** Teto medido do gateway, em ids de uuid. Não é alvo: é o abismo. */
export const URL_SAFE_MAX_IDS = 641;

/** Tabelas 1:1 com o id (ex.: `leads`). 200 × 39,3 B ≈ 7,9 KB = 3,2× de margem. */
export const IN_CHUNK_SIZE = 200;

/**
 * Tabelas N:1 (`pipeline_entries`, `lead_tags`, `whatsapp_conversation_tags`).
 * Aqui o orçamento que aperta primeiro NÃO é a URL: é o teto de linhas por
 * resposta do PostgREST (`db-max-rows`), que trunca EM SILÊNCIO. Esse teto é
 * config do gateway e não dá pra ler via SQL — não foi possível confirmar o
 * valor em PROD, então o lote é dimensionado pelo pior caso conhecido.
 * Fan-out medido em PROD (2026-07-31): até 4 entries/lead e até 7 tags/lead.
 * 100 × 7 = 700 linhas, abaixo do 1000 que é o default histórico do PostgREST.
 */
export const IN_CHUNK_SIZE_FANOUT = 100;

/** Acima disto, provavelmente bateu num teto de linhas e a resposta veio cortada. */
const MAX_ROWS_SUSPECT = 1000;

/** Formato mínimo da resposta do postgrest-js que o helper consome. */
export interface ChunkedResult<Row> {
  data: Row[] | null;
  error: unknown;
}

/** Fatia uma lista em lotes de no máximo `size`. */
export function chunkIds<T>(ids: readonly T[], size: number = IN_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("chunkIds: size precisa ser inteiro >= 1");
  }
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Dedupa, fatia, dispara os lotes em paralelo e concatena.
 *
 * LANÇA no primeiro erro — resultado parcial é pior que erro: um meio-mapa de
 * funis filtraria errado sem ninguém notar. Foi exatamente a falha silenciosa
 * (`res.data || []` sem checar `error`) que fez este bug durar. Chamador que
 * prefira degradar em vez de falhar precisa dizer isso explicitamente, no
 * `catch` dele.
 *
 * @param ids   ids a consultar (duplicatas são removidas).
 * @param run   recebe um lote e devolve o builder do supabase já montado.
 * @param size  tamanho do lote. Use `IN_CHUNK_SIZE_FANOUT` quando a tabela
 *              devolve várias linhas por id.
 */
export async function selectInChunks<Row>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<ChunkedResult<Row>>,
  size: number = IN_CHUNK_SIZE,
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const parts = await Promise.all(
    chunkIds(unique, size).map(async (chunk) => {
      const { data, error } = await run(chunk);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length >= MAX_ROWS_SUSPECT) {
        console.error(
          `[selectInChunks] lote de ${chunk.length} ids devolveu ${rows.length} linhas — ` +
            "provável truncamento por teto de linhas do PostgREST. Baixe o chunk size deste call site.",
        );
      }
      return rows;
    }),
  );

  return parts.flat();
}
