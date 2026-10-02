/**
 * Fronteira de chunk: a gravação de sessão pesa mais que o resto do SDK junto e
 * só é necessária depois que a página assentou. Importada dinamicamente por
 * `sentry.ts`; o Rollup separa o código do replay neste chunk.
 */
export { replayIntegration } from "@sentry/react";
