/**
 * Erros do Torque — contrato, normalização e notificação (ADR-0038).
 *
 * Para mostrar um erro ao usuário, use `notifyError(err, { fallback })`.
 * Nunca `toast.error(err.message)`: a mensagem técnica não vai para a tela.
 *
 * Os handlers globais do React Query ficam fora deste barrel
 * (`@/shared/errors/query-error-handlers`): só o `App.tsx` precisa deles, e
 * reexportá-los aqui puxaria `@tanstack/react-query` para toda tela que mostra
 * erro — inclusive a de preview pública, que não pode alcançar o app.
 */
export type { AppError, ErrorAction, ErrorActionKind, ErrorCode } from "./app-error";
export { ERROR_CATALOG } from "./catalog";
export {
  DEFAULT_FALLBACK,
  isAppError,
  isHumanPortugueseMessage,
  referenceFor,
  toAppError,
  userMessageOf,
  type FunctionsErrorBody,
} from "./to-app-error";
export { functionsErrorFromResponse, unwrapFunctionsError } from "./unwrap-functions-error";
export { notifyError, showErrorToast, type NotifyErrorOptions } from "./notify";
export {
  addErrorReporter,
  reportError,
  ringBufferEntry,
  setReportIdentity,
  type ErrorReport,
  type ErrorReporter,
  type ReportIdentity,
} from "./report";
export {
  canOpenSupport,
  openSupport,
  registerSupportLauncher,
  supportPrefillFor,
  type SupportPrefill,
} from "./support-launcher";
export { ErrorReference, ErrorToastDescription } from "./ErrorReference";
export { scrubPii, technicalSummary } from "./scrub";
export { getErrorMessage } from "./get-error-message";
