/**
 * request-trace — lê os ids de correlação que o frontend carimba em toda
 * chamada (`src/core/trace/request-trace.ts`).
 *
 *   session_id  Uma sessão de navegação. Dado um Chamado, o suporte consulta
 *               `runtime_logs WHERE session_id = X ORDER BY created_at`.
 *   request_id  Uma chamada HTTP.
 *
 * Não confundir com o `trace_id` do Copilot v2 (`copilot-v2/trace-context.ts`),
 * que identifica um turno do agente — outra granularidade, outra tabela.
 *
 * Ver docs/adr/0017-drop-sentry-for-in-house-runtime-logs.md
 */

export const SESSION_ID_HEADER = "x-torque-session-id";
export const REQUEST_ID_HEADER = "x-torque-request-id";

export interface RequestTrace {
  sessionId: string | null;
  requestId: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * As colunas em `runtime_logs` são UUID. Um header malformado (ou forjado por
 * um cliente hostil) faria o INSERT falhar, e `logRuntime` engole a falha —
 * perderíamos a linha inteira em silêncio. Descartar só o id inválido preserva
 * o resto do log.
 */
function asUuidOrNull(value: string | null): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

export function getTraceContext(req: Request): RequestTrace {
  return {
    sessionId: asUuidOrNull(req.headers.get(SESSION_ID_HEADER)),
    requestId: asUuidOrNull(req.headers.get(REQUEST_ID_HEADER)),
  };
}
