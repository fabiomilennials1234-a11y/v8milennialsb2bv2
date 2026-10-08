import { createElement } from "react";
import { toast } from "sonner";
import type { AppError } from "./app-error";
import { ErrorToastDescription } from "./ErrorReference";
import { reportError } from "./report";
import { canOpenSupport, openSupport, supportPrefillFor } from "./support-launcher";
import { toAppError } from "./to-app-error";
import { unwrapFunctionsError } from "./unwrap-functions-error";

export interface NotifyErrorOptions {
  /**
   * Mensagem PT para quando nada mais específico se aplica, do ponto de vista do
   * usuário: "Não foi possível mover o card." Nunca técnica.
   */
  fallback: string;
  /** Tags seguras para o relatório (sem PII): `{ feature: "kanban" }`. */
  context?: Record<string, string>;
  /** Só relata, sem toast — para quando a tela já mostra o erro inline. */
  silent?: boolean;
  /**
   * Linha secundária acima do código. Para o raro caso em que um texto que não
   * é nosso ajuda o usuário a agir — o motivo que o fornecedor deu para recusar
   * um envio, por exemplo. Nunca a mensagem técnica do erro.
   */
  detail?: string;
  /**
   * Tradução de domínio já feita por quem chama ("Este funil ainda é o padrão
   * da organização. Escolha o substituto…"). Vence a mensagem do catálogo; o
   * erro continua sendo relatado e o código continua no toast.
   */
  message?: string;
}

/** Tempo de leitura de um erro: o dobro do padrão do sonner. */
const ERROR_TOAST_DURATION_MS = 8000;

const SIGN_IN_PATH = "/auth";

function toastAction(error: AppError): { label: string; onClick: () => void } | undefined {
  if (error.action?.kind === "sign_in") {
    return { label: error.action.label, onClick: () => window.location.assign(SIGN_IN_PATH) };
  }
  if (error.action?.kind === "support" && canOpenSupport()) {
    return {
      label: error.action.label,
      onClick: () => {
        openSupport(supportPrefillFor(error.userMessage, error.reference));
      },
    };
  }
  return undefined;
}

/**
 * O toast padrão de erro: mensagem humana, código copiável e, quando cabe, uma
 * ação. O `id` agrupa repetições — o mesmo erro disparado cinco vezes seguidas
 * atualiza um toast em vez de empilhar cinco.
 */
export function showErrorToast(error: AppError, detail?: string): void {
  toast.error(error.userMessage, {
    id: `app-error:${error.code}:${error.userMessage}`,
    description: createElement(ErrorToastDescription, { reference: error.reference, detail }),
    duration: ERROR_TOAST_DURATION_MS,
    action: toastAction(error),
  });
}

function deliver(error: AppError, options: NotifyErrorOptions): void {
  reportError(error, { source: "handled", ...options.context });
  if (options.silent) return;
  const message = options.message?.trim();
  showErrorToast(message ? { ...error, userMessage: message } : error, options.detail?.trim() || undefined);
}

function isFunctionsHttpError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "FunctionsHttpError";
}

/**
 * Relata e mostra um erro numa chamada só (ADR-0038).
 *
 * ```ts
 * catch (err) {
 *   notifyError(err, { fallback: "Não foi possível salvar o lead." });
 * }
 * ```
 *
 * Substitui `toast.error(err.message)`, que mostrava texto técnico ao cliente e
 * não deixava rastro nenhum. Erro de edge function tem o corpo lido antes do
 * toast (alguns milissegundos), para a recusa em PT que a função escreveu chegar
 * à tela em vez de "Edge Function returned a non-2xx status code".
 */
export function notifyError(error: unknown, options: NotifyErrorOptions): void {
  if (!isFunctionsHttpError(error)) {
    deliver(toAppError(error, options.fallback), options);
    return;
  }
  unwrapFunctionsError(error).then(
    (unwrapped) => deliver(toAppError(unwrapped, options.fallback), options),
    () => deliver(toAppError(error, options.fallback), options),
  );
}
