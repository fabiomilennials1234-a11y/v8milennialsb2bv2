/**
 * Extração de mensagem de erro legível a partir de qualquer throw.
 *
 * Cobre os formatos que aparecem no app:
 * - Supabase `PostgrestError` ({ message, details, hint, code }) — o caso comum
 *   em mutations/queries; `details`/`hint` carregam a causa real (FK, RLS, check).
 * - `Error` nativo (.message).
 * - string crua.
 * - fallback para JSON/`String(x)` em formatos inesperados.
 *
 * Usado pra transformar catches cegos ("Erro ao salvar") em toasts com a causa
 * técnica visível — sem isso, incidentes em prod ficam impossíveis de diagnosticar
 * (ver incidente Basic4u "erro ao adicionar reunião", 2026-06-09).
 */

interface PostgrestLikeError {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Retorna a mensagem mais informativa disponível no erro.
 * Concatena `message` + `details` quando ambos existem e diferem (PostgrestError
 * costuma pôr o resumo em `message` e a causa concreta em `details`/`hint`).
 */
export function getErrorMessage(error: unknown): string {
  if (error == null) return "Erro desconhecido";

  if (typeof error === "string") return error.trim() || "Erro desconhecido";

  if (error instanceof Error && error.message) return error.message;

  if (isRecord(error)) {
    const e = error as PostgrestLikeError;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
    if (typeof e.details === "string" && e.details.trim() && !parts.includes(e.details.trim())) {
      parts.push(e.details.trim());
    }
    if (typeof e.hint === "string" && e.hint.trim()) parts.push(e.hint.trim());

    if (parts.length > 0) {
      const code = typeof e.code === "string" && e.code.trim() ? ` (${e.code.trim()})` : "";
      return `${parts.join(" — ")}${code}`;
    }

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      /* circular/unserializable — cai no fallback abaixo */
    }
  }

  return String(error);
}
