/**
 * `noRetryOnTimeout` — política de retry para TanStack Query que falha rápido
 * em statement_timeout do Postgres (error code 57014).
 *
 * Uso típico em hooks que tocam tabelas grandes onde uma query lenta hoje
 * vai continuar lenta nos próximos 100ms — retentar 3× só amplifica latência
 * percebida sem chance de cura.
 *
 *   useQuery({
 *     ...
 *     retry: noRetryOnTimeout,
 *   });
 */

const DEFAULT_MAX_RETRIES = 3;
const POSTGRES_STATEMENT_TIMEOUT = "57014";

interface MaybePostgresError {
  code?: unknown;
}

export function noRetryOnTimeout(failureCount: number, error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    (error as MaybePostgresError).code === POSTGRES_STATEMENT_TIMEOUT
  ) {
    return false;
  }
  return failureCount < DEFAULT_MAX_RETRIES;
}
