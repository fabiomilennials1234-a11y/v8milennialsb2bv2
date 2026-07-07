import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Detecta erros estruturais de banco (função/tabela/coluna inexistente) — tipicamente
 * sinal de migration pendente em produção. Nesses casos a UI degrada para estado
 * vazio em vez de exibir tela de erro, já que o throw anterior mascarava o app
 * inteiro quando uma migration atrasava.
 *
 * Códigos PostgREST relevantes:
 *   PGRST202 — função não encontrada no schema cache
 *   PGRST205 — tabela não encontrada
 *   PGRST204 — coluna não encontrada
 *   42883   — undefined_function (Postgres)
 *   42P01   — undefined_table
 *   42703   — undefined_column
 */
export function isMissingSchemaError(
  error: PostgrestError | { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = (error as PostgrestError).code ?? "";
  if (["PGRST202", "PGRST205", "PGRST204", "42883", "42P01", "42703"].includes(code)) {
    return true;
  }
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

/**
 * Predicado ESTRITO de "RPC ausente" (função inexistente no schema) — detecta
 * EXCLUSIVAMENTE por código, nunca por substring de mensagem.
 *
 *   PGRST202 — função não encontrada no schema cache (PostgREST)
 *   42883    — undefined_function (Postgres)
 *
 * WHY (code-review FIX-A): os overlays canônicos (get_sales_metrics, get_ranking,
 * get_commission_ledger) sobrepõem receita real sobre a base legada e DEGRADAM
 * pro legado quando a RPC canônica ainda não foi migrada. Se usassem o matcher
 * amplo `isMissingSchemaError`, uma RPC canônica JÁ IMPLANTADA que lançasse um
 * erro de runtime legítimo cujo texto contém "…does not exist" (coluna errada,
 * cast inválido) seria lida como "ausente" → o dashboard degradaria em silêncio
 * pra receita legada e a TV pra zeros, ESCONDENDO dinheiro errado. Por código, um
 * erro de runtime real (código != PGRST202/42883) NÃO é tratado como ausente:
 * propaga (throw) e a superfície de erro aparece, em vez de mascarar.
 *
 * Use este predicado APENAS nos overlays canônicos. Os leitores legados seguem em
 * `isMissingSchemaError` (a RPC legada realmente pode faltar em dev/migração).
 */
export function isRpcAbsentError(
  error: PostgrestError | { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = (error as PostgrestError).code ?? "";
  return code === "PGRST202" || code === "42883";
}
