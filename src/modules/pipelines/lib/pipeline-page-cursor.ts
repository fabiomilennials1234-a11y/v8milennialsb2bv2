/**
 * Cursor de `get_pipeline_page` — keyset COMPOSTO `(created_at, id)`.
 *
 * A RPC ordena por `created_at DESC, id DESC` (ordem total) e continua a
 * partir de `created_at < p_cursor OR (created_at = p_cursor AND id <
 * p_cursor_id)` — migration 20271230000100.
 *
 * Por que o id: import em lote grava dezenas de negócios no MESMO instante.
 * Com cursor só de `created_at` e `<` estrito, a borda de uma página caindo
 * dentro do grupo empatado pulava as irmãs para sempre — elas não entravam nem
 * nesta página nem na seguinte (Café Jurerê, 09/11/2026: ~800 de 2.212 cards
 * inalcançáveis na rolagem; prod inteira, 9.074 cards em grupos empatados).
 *
 * Cursor sempre carrega TODAS as colunas da ordem. Nunca devolva só o
 * `created_at`: a RPC aceita (compat com bundle antigo) e volta a perder linha.
 */
export interface PipelinePageCursor {
  createdAt: string;
  id: string;
}

interface CursorRow {
  id?: unknown;
  created_at?: unknown;
}

/**
 * Próximo cursor a partir da última página. `undefined` = acabou (página
 * incompleta) ou a linha não traz as colunas da ordem — aí parar é mais seguro
 * que pedir uma página que pularia ou repetiria linhas.
 */
export function nextPipelinePageCursor(
  lastPage: readonly CursorRow[],
  pageSize: number,
): PipelinePageCursor | undefined {
  if (lastPage.length < pageSize) return undefined;
  const last = lastPage[lastPage.length - 1];
  if (typeof last?.created_at !== "string" || typeof last?.id !== "string") return undefined;
  return { createdAt: last.created_at, id: last.id };
}

/** Argumentos de cursor da RPC. `null` = primeira página. */
export function pipelinePageCursorArgs(cursor: PipelinePageCursor | null | undefined): {
  p_cursor: string | null;
  p_cursor_id: string | null;
} {
  return { p_cursor: cursor?.createdAt ?? null, p_cursor_id: cursor?.id ?? null };
}
