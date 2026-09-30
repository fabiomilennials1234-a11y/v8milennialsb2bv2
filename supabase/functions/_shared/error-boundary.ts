/**
 * Top-level error boundary for Supabase Edge Functions (Deno).
 *
 * Replaces the former `sentry.ts` (ADR-0017). Despite its old name, that module
 * was never merely a reporting hook: its `withSentry` was — and this
 * `withErrorBoundary` remains — the outermost try/catch of every edge function.
 * It turns an unhandled exception into a 500 that still carries the CORS headers,
 * without which the caller's browser reports a CORS failure and the real error
 * is lost.
 *
 * Observability now lives in `runtime_logs` (see `logger.ts#logRuntime`). Since
 * ADR-0038 (S6) the unhandled exception also goes to Sentry — `sentry.ts` again,
 * but now a reporter only, reached from here and only with `SENTRY_DSN_EDGE`.
 */

import { getCorsHeaders } from "./cors.ts";
import { getTraceContext } from "./request-trace.ts";

interface LogContext {
  functionName?: string;
  organizationId?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Structured error log. Never throws.
 *
 * Async and returning `Promise<void>` to stay drop-in compatible with the
 * `await logError(...).catch(() => {})` call sites inherited from `captureError`.
 */
// deno-lint-ignore require-await
export async function logError(
  error: unknown,
  context?: LogContext,
): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        level: "error",
        function_name: context?.functionName,
        organization_id: context?.organizationId,
        user_id: context?.userId,
        error: { name: err.name, message: err.message, stack: err.stack },
        ...context?.extra,
      }),
    );
  } catch {
    // Logging must never break the function.
  }
}

/**
 * Structured info-level event. Never throws.
 */
// deno-lint-ignore require-await
export async function logEvent(
  message: string,
  context?: LogContext & { tags?: Record<string, string | number | boolean> },
): Promise<void> {
  try {
    console.log(
      JSON.stringify({
        level: "info",
        event: message,
        function_name: context?.functionName,
        organization_id: context?.organizationId,
        user_id: context?.userId,
        ...context?.tags,
        ...context?.extra,
      }),
    );
  } catch {
    // Logging must never break the function.
  }
}

/**
 * O que o cliente recebe quando a função quebra (ADR-0038, S5).
 *
 * `error` continua string — os chamadores leem `body.error` — mas agora é uma
 * frase em PT, e não a mensagem técnica da exceção ("Cannot read properties of
 * undefined"), que ia parar no toast. `code` é o do contrato do front
 * (`src/shared/errors`), e `request_id` casa a resposta com a linha no
 * `runtime_logs` e, na S6, com o evento no Sentry.
 */
export const UNHANDLED_ERROR_MESSAGE = "Tivemos um problema do nosso lado. Tente de novo em instantes.";

function userIdFromJwt(req: Request): string | undefined {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return undefined;
    const payloadPart = authHeader.replace("Bearer ", "").split(".")[1];
    if (!payloadPart) return undefined;
    const sub = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"))).sub;
    return typeof sub === "string" ? sub : undefined;
  } catch {
    // Ignore JWT parse errors — the error we are reporting matters more.
    return undefined;
  }
}

/**
 * Wraps an Edge Function handler so that an unhandled exception becomes a
 * CORS-bearing 500 instead of an opaque crash. Compatible with `Deno.serve()`.
 *
 * A exceção vai para três lugares: `console.error` (logs da função), a tabela
 * `runtime_logs` (retenção de 30 dias, correlacionável por sessão/requisição —
 * antes do ADR-0038 ela só ia para o console, que expira rápido) e a resposta,
 * que leva só a frase PT, o código e o `request_id`.
 */
export function withErrorBoundary(
  functionName: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      const userId = userIdFromJwt(req);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${functionName}] Unhandled error:`, errorMessage);

      const trace = getTraceContext(req);
      const requestId = trace.requestId ?? crypto.randomUUID();

      await logError(error, {
        functionName,
        userId,
        extra: { method: req.method, url: req.url, sessionId: trace.sessionId, requestId },
      });

      // Import dinâmico: `logger.ts` importa `logError` deste arquivo; um import
      // estático fecharia o ciclo. `logRuntime` nunca lança.
      try {
        const { logRuntime } = await import("./logger.ts");
        await logRuntime({
          module: "general",
          action: "unhandled_exception",
          status: "error",
          errorMessage: errorMessage.slice(0, 2000),
          triggeredBy: userId,
          sessionId: trace.sessionId,
          requestId,
          payloadSnapshot: { function: functionName, method: req.method },
        });
      } catch {
        // Telemetria nunca muda a resposta.
      }

      // Sentry (ADR-0038, S6): só com `SENTRY_DSN_EDGE`. Import dinâmico pelo
      // mesmo motivo do de cima e para o SDK não pesar no cold start de quem
      // não quebrou. Não segura a resposta (`EdgeRuntime.waitUntil`).
      try {
        const { captureUnhandled } = await import("./sentry.ts");
        await captureUnhandled(error, {
          functionName,
          requestId,
          sessionId: trace.sessionId,
          userId,
          method: req.method,
          url: req.url,
        });
      } catch {
        // Telemetria nunca muda a resposta.
      }

      const corsHeaders = getCorsHeaders(req.headers.get("origin"));

      return new Response(
        JSON.stringify({
          error: UNHANDLED_ERROR_MESSAGE,
          code: "server.unavailable",
          request_id: requestId,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-ID": requestId },
        },
      );
    }
  };
}
