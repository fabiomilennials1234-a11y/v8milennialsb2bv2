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
 * Observability now lives in `runtime_logs` (see `logger.ts#logRuntime`).
 */

import { getCorsHeaders } from "./cors.ts";

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
 * Wraps an Edge Function handler so that an unhandled exception becomes a
 * CORS-bearing 500 instead of an opaque crash. Compatible with `Deno.serve()`.
 */
export function withErrorBoundary(
  functionName: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      let userId: string | undefined;

      try {
        const authHeader = req.headers.get("authorization");
        if (authHeader) {
          const payloadPart = authHeader.replace("Bearer ", "").split(".")[1];
          if (payloadPart) userId = JSON.parse(atob(payloadPart)).sub;
        }
      } catch {
        // Ignore JWT parse errors — the error we are reporting matters more.
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${functionName}] Unhandled error:`, errorMessage);

      await logError(error, {
        functionName,
        userId,
        extra: { method: req.method, url: req.url },
      });

      const corsHeaders = getCorsHeaders(req.headers.get("origin"));

      return new Response(
        JSON.stringify({
          error: errorMessage || "Ocorreu um erro interno. Tente novamente mais tarde.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  };
}
