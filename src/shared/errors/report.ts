import { recordClientError } from "@/core/observability/client-error-buffer";
import type { AppError } from "./app-error";
import { getErrorMessage } from "./get-error-message";

/**
 * Para onde vai um erro depois de normalizado (ADR-0038, decisão 2).
 *
 * Dois destinos:
 * - o anel de erros do navegador, que é anexado a um Chamado — sempre;
 * - um `ErrorReporter` externo (o Sentry, na fatia S6) — quando registrado.
 *
 * Este módulo não conhece o Sentry. Quem conhece registra um reporter no
 * bootstrap (`setErrorReporter`), e trocar de vendor é trocar essa função.
 */

export interface ErrorReport {
  error: AppError;
  /** Tags seguras: sem PII, sem conteúdo. Ex.: `{ source: "mutation", feature: "kanban" }`. */
  context: Record<string, string>;
}

export type ErrorReporter = (report: ErrorReport) => void;

let reporter: ErrorReporter | null = null;

export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

/**
 * Um mesmo objeto de erro costuma passar por dois tratadores — o `MutationCache`
 * global e o `catch` da tela. Relatamos uma vez só.
 */
const reported = new WeakSet<object>();

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function causeName(cause: unknown): string {
  if (isObject(cause) && "name" in cause && typeof cause.name === "string" && cause.name) {
    return cause.name;
  }
  return "AppError";
}

export function reportError(error: AppError, context: Record<string, string> = {}): void {
  const { cause } = error;
  if (isObject(cause)) {
    if (reported.has(cause)) return;
    reported.add(cause);
  }

  try {
    // O anel guarda a causa técnica, com a mesma referência que o usuário vê no
    // toast: quem lê o Chamado casa uma coisa com a outra.
    const entry = new Error(`[${error.reference}] ${error.code}: ${getErrorMessage(cause)}`);
    entry.name = causeName(cause);
    if (cause instanceof Error && cause.stack) entry.stack = cause.stack;
    recordClientError(entry, "handled");
  } catch {
    // Registrar um erro jamais pode lançar outro.
  }

  try {
    reporter?.({ error, context });
  } catch {
    // Idem: o vendor falhar não muda o que o usuário vê.
  }
}

/** Apenas para testes. */
export function resetErrorReporterForTests(): void {
  reporter = null;
}
