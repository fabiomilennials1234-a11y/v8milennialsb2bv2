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
