/**
 * support-context — o mundo quando quebrou.
 *
 * O snapshot que um Chamado carrega: a evidência técnica que o usuário não
 * deveria ter que reproduzir à mão. Imutável depois de gravado (o banco recusa
 * qualquer reescrita — ver o trigger em `support_tickets`).
 *
 * Captura silenciosa. Nada aqui expõe conteúdo: rota sanitizada, versão do app,
 * browser, viewport, os últimos erros deste browser, e o `session_id` que amarra
 * o Chamado ao que o backend fez naquela sessão, em `runtime_logs`.
 *
 * Ver docs/adr/0017-drop-sentry-for-in-house-runtime-logs.md
 */

import { readClientErrors, type ClientError } from "./client-error-buffer";

/**
 * Parâmetros que descrevem *a tela*, não *o dado*. Tudo o mais tem o valor
 * apagado: `?q=Fulano` é o nome de um lead do nosso cliente, e a rota vai parar
 * num Chamado que o suporte da Torque lê.
 */
const SAFE_QUERY_KEYS = new Set([
  "pipe",
  "tab",
  "view",
  "stage",
  "page",
  "filter",
  "sort",
  "period",
  "new",
]);

export function sanitizeRoute(pathname: string, search: string): string {
  if (!search || search === "?") return pathname;

  const params = new URLSearchParams(search);
  const parts: string[] = [];
  for (const [key] of params) {
    parts.push(SAFE_QUERY_KEYS.has(key) ? `${key}=${params.get(key)}` : `${key}=`);
  }

  return parts.length > 0 ? `${pathname}?${parts.join("&")}` : pathname;
}

export interface SupportContextInput {
  pathname: string;
  search: string;
  appVersion: string;
  userAgent: string;
  viewport: { width: number; height: number };
  organizationId: string | null;
  userId: string | null;
  role: string | null;
  sessionId: string;
}

export interface SupportContext {
  route: string;
  app_version: string;
  user_agent: string;
  viewport: { width: number; height: number };
  org_id: string | null;
  user_id: string | null;
  role: string | null;
  session_id: string;
  client_errors: ClientError[];
  captured_at: string;
}

export function buildSupportContext(input: SupportContextInput): SupportContext {
  return {
    route: sanitizeRoute(input.pathname, input.search),
    app_version: input.appVersion,
    user_agent: input.userAgent,
    viewport: input.viewport,
    org_id: input.organizationId,
    user_id: input.userId,
    role: input.role,
    session_id: input.sessionId,
    client_errors: readClientErrors(),
    captured_at: new Date().toISOString(),
  };
}
