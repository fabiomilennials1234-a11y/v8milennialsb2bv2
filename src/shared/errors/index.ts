/**
 * Erros do Torque — contrato, normalização e notificação (ADR-0038).
 *
 * Para mostrar um erro ao usuário, use `notifyError(err, { fallback })`.
 * Nunca `toast.error(err.message)`: a mensagem técnica não vai para a tela.
 */
export type { AppError, ErrorAction, ErrorActionKind, ErrorCode } from "./app-error";
export { ERROR_CATALOG } from "./catalog";
export {
  DEFAULT_FALLBACK,
  isAppError,
  isHumanPortugueseMessage,
  referenceFor,
  toAppError,
  type FunctionsErrorBody,
} from "./to-app-error";
export { unwrapFunctionsError } from "./unwrap-functions-error";
export { notifyError, showErrorToast, type NotifyErrorOptions } from "./notify";
export { reportError, setErrorReporter, type ErrorReport, type ErrorReporter } from "./report";
export {
  canOpenSupport,
  openSupport,
  registerSupportLauncher,
  supportPrefillFor,
  type SupportPrefill,
} from "./support-launcher";
export { ErrorReference } from "./ErrorReference";
export { createQueryErrorHandlers } from "./query-error-handlers";
export { scrubPii, technicalSummary } from "./scrub";
export { getErrorMessage } from "./get-error-message";
