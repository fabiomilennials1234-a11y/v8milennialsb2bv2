import type { AppError } from "./app-error";
import { technicalSummary } from "./scrub";

/**
 * Para onde vai um erro depois de normalizado (ADR-0038, decisão 2).
 *
 * Este módulo não conhece destino nenhum. Quem conhece se registra no bootstrap
 * (`main.tsx`) com `addErrorReporter`:
 *
 * - o anel de erros do navegador, anexado a um Chamado (`src/core/observability`);
 * - o vendor (o Sentry, na fatia S6).
 *
 * A inversão é de propósito: `shared` não pode depender de `core` (regra de
 * camadas), e a tela pública de preview (`/preview.html`, sem login) usa
 * `notifyError` sem poder alcançar nada do app — `tests/unit/preview-cards-sem-banco`.
 * Trocar de vendor é trocar uma função registrada.
 */

export interface ErrorReport {
  error: AppError;
  /** Tags seguras: sem PII, sem conteúdo. Ex.: `{ source: "mutation", feature: "kanban" }`. */
  context: Record<string, string>;
}

export type ErrorReporter = (report: ErrorReport) => void;

const reporters = new Set<ErrorReporter>();

/** Registra um destino. Devolve a função que desfaz o registro. */
export function addErrorReporter(reporter: ErrorReporter): () => void {
  reporters.add(reporter);
  return () => {
    reporters.delete(reporter);
  };
}

/**
 * Um mesmo objeto de erro costuma passar por dois tratadores — o `MutationCache`
 * global e o `catch` da tela. Relatamos uma vez só.
 */
const reported = new WeakSet<object>();

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function reportError(error: AppError, context: Record<string, string> = {}): void {
  const { cause } = error;
  if (isObject(cause)) {
    if (reported.has(cause)) return;
    reported.add(cause);
  }

  for (const reporter of reporters) {
    try {
      reporter({ error, context });
    } catch {
      // Um destino falhar não impede os outros nem muda o que o usuário vê.
    }
  }
}

/**
 * A entrada do anel do Chamado: a causa técnica, com a mesma referência que o
 * usuário vê no toast — quem lê o Chamado casa uma coisa com a outra. Sem
 * `details` do Postgres e com telefone/e-mail mascarados, porque o anel vai para
 * o `support_context`.
 */
export function ringBufferEntry(error: AppError): Error {
  const { cause } = error;
  const entry = new Error(`[${error.reference}] ${error.code} · ${technicalSummary(cause)}`);
  entry.name =
    isObject(cause) && "name" in cause && typeof cause.name === "string" && cause.name ? cause.name : "AppError";
  if (cause instanceof Error && cause.stack) entry.stack = cause.stack;
  return entry;
}
