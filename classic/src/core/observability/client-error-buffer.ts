/**
 * client-error-buffer — os últimos erros que este browser sofreu.
 *
 * Metade da observabilidade do frontend (ADR-0017). `runtime_logs` cobre as
 * edge functions; a maioria esmagadora das ações vai direto a PostgREST e nunca
 * toca uma delas — negação de RLS, violação de constraint, 400, erro de render.
 * Nada disso aparece do lado do servidor. Só o cliente vê.
 *
 * Não é tabela e não é stream: um anel em memória, existindo apenas para ser
 * anexado ao Support Context de um Chamado quando o usuário abre um.
 */

/** Um dia inteiro de aba aberta não pode virar um vazamento de memória. */
export const CLIENT_ERROR_CAPACITY = 20;

const MESSAGE_MAX = 500;
const STACK_MAX = 2000;

export type ClientErrorSource = "unhandled" | "rejection" | "request";

export interface ClientError {
  at: string;
  source: ClientErrorSource;
  name: string;
  message: string;
  stack?: string;
}

const buffer: ClientError[] = [];

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function push(entry: ClientError): void {
  buffer.push(entry);
  if (buffer.length > CLIENT_ERROR_CAPACITY) buffer.shift();
}

export function recordClientError(error: unknown, source: ClientErrorSource): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    push({
      at: new Date().toISOString(),
      source,
      name: err.name || "Error",
      message: truncate(err.message, MESSAGE_MAX),
      stack: err.stack ? truncate(err.stack, STACK_MAX) : undefined,
    });
  } catch {
    // Registrar um erro jamais pode lançar outro.
  }
}

/**
 * Uma chamada HTTP que falhou.
 *
 * A query string é descartada. Um filtro do PostgREST é literalmente
 * `?name=eq.Fulano` — PII de um lead do nosso cliente, a caminho de um Chamado.
 */
export function recordRequestFailure(method: string, url: string, status: number): void {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0];
  }
  push({
    at: new Date().toISOString(),
    source: "request",
    name: "RequestFailed",
    message: truncate(`${method} ${path} → ${status}`, MESSAGE_MAX),
  });
}

export function readClientErrors(): ClientError[] {
  return buffer.map((e) => ({ ...e }));
}

export function clearClientErrors(): void {
  buffer.length = 0;
}

// ─── Captura global ─────────────────────────────────────────────────────────

let installed = false;

function onError(event: ErrorEvent) {
  recordClientError(event.error ?? event.message, "unhandled");
}

function onRejection(event: PromiseRejectionEvent) {
  recordClientError(event.reason, "rejection");
}

/**
 * Escuta os erros que ninguém tratou. Idempotente: instalar duas vezes não
 * registra o mesmo erro duas vezes.
 */
export function installClientErrorCapture(): () => void {
  if (installed) return () => undefined;
  installed = true;

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    installed = false;
  };
}
