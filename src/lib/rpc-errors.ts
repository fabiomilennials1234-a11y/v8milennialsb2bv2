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

/**
 * Marcador da recusa do banco quando um negócio é fechado como ganho sem valor.
 *
 * CONTRATO com `fn_exige_valor_no_negocio` (migration 20270916000010): a função
 * levanta `check_violation` com exatamente esta frase, e a tela reconhece a
 * recusa por ela para abrir o campo de valor em vez de despejar erro de banco
 * num toast.
 *
 * `tests/unit/sale-value-guard.contrato.test.ts` lê a migration e falha se as
 * pontas divergirem. Reescrever a mensagem sem reescrever este marcador devolve
 * o usuário ao beco: a tela pede um valor que a tela não deixa digitar.
 *
 * Mora AQUI, e não no módulo `pipelines`, porque quem precisa dela é o painel
 * de negócio, em `leads`. `pipelines/index.ts` já importa `leads/index.ts` —
 * qualquer import na volta fecha ciclo estático, medido pelo dep-cruiser. Este
 * arquivo é neutro e já é a casa dos predicados de erro de banco.
 */
export const SALE_VALUE_REQUIRED_MARKER = "valor antes de marcar";

/**
 * A recusa veio da trava de valor no negócio?
 *
 * Dois sinais, ambos exigidos: o SQLSTATE `23514` (check_violation) e o
 * marcador acima. Só o código seria largo demais — qualquer CHECK da tabela
 * cairia aqui e a tela pediria um valor que não resolveria nada.
 */
export function isSaleValueRequiredError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code !== "23514") return false;
  return (error.message ?? "").includes(SALE_VALUE_REQUIRED_MARKER);
}
