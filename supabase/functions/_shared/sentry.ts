/**
 * Sentry error reporting for Supabase Edge Functions (Deno)
 *
 * Uses the Sentry HTTP API directly since the official SDK
 * does not support Deno.
 */

interface SentryContext {
  functionName?: string;
  organizationId?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Sends an error event to Sentry via HTTP envelope API.
 * Never throws — silently fails if Sentry is unreachable or misconfigured.
 */
export async function captureError(
  error: unknown,
  context?: SentryContext,
): Promise<void> {
  try {
    const dsn = Deno.env.get("SENTRY_DSN");
    if (!dsn) return;

    const parsed = parseDsn(dsn);
    if (!parsed) return;

    const environment = Deno.env.get("ENVIRONMENT") || "production";
    const timestamp = Date.now() / 1000;
    const eventId = crypto.randomUUID().replace(/-/g, "");

    const err = error instanceof Error ? error : new Error(String(error));

    const event: Record<string, unknown> = {
      event_id: eventId,
      timestamp,
      platform: "node",
      level: "error",
      server_name: "supabase-edge-functions",
      environment,
      exception: {
        values: [
          {
            type: err.name || "Error",
            value: err.message,
            stacktrace: err.stack
              ? { frames: parseStackFrames(err.stack) }
              : undefined,
          },
        ],
      },
      tags: {
        runtime: "deno",
        ...(context?.functionName && { function_name: context.functionName }),
        ...(context?.organizationId && {
          organization_id: context.organizationId,
        }),
      },
      user: context?.userId ? { id: context.userId } : undefined,
      extra: {
        ...(context?.functionName && { function_name: context.functionName }),
        ...(context?.organizationId && {
          organization_id: context.organizationId,
        }),
        ...context?.extra,
      },
    };

    const envelopeHeader = JSON.stringify({
      event_id: eventId,
      dsn,
      sent_at: new Date().toISOString(),
    });
    const itemHeader = JSON.stringify({
      type: "event",
      content_type: "application/json",
    });
    const payload = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}`;

    const url = `${parsed.uri}/api/${parsed.projectId}/envelope/`;

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=edge-functions/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: payload,
    });
  } catch {
    // Silently ignore — never let Sentry reporting break the function
  }
}

/**
 * Wraps an Edge Function handler with Sentry error reporting.
 * Returns a handler compatible with Deno.serve().
 */
export function withSentry(
  functionName: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      // Try to extract context from the request
      let organizationId: string | undefined;
      let userId: string | undefined;

      try {
        const authHeader = req.headers.get("authorization");
        if (authHeader) {
          const token = authHeader.replace("Bearer ", "");
          const payloadPart = token.split(".")[1];
          if (payloadPart) {
            const decoded = JSON.parse(atob(payloadPart));
            userId = decoded.sub;
          }
        }
      } catch {
        // Ignore JWT parse errors
      }

      await captureError(error, {
        functionName,
        organizationId,
        userId,
        extra: {
          method: req.method,
          url: req.url,
        },
      });

      return new Response(
        JSON.stringify({
          error: "Ocorreu um erro interno. Tente novamente mais tarde.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

// --- Internal helpers ---

interface ParsedDsn {
  publicKey: string;
  uri: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace("/", "");
    const uri = `${url.protocol}//${url.host}`;
    if (!publicKey || !projectId) return null;
    return { publicKey, uri, projectId };
  } catch {
    return null;
  }
}

function parseStackFrames(
  stack: string,
): Array<{ filename?: string; function?: string; lineno?: number; colno?: number }> {
  const lines = stack.split("\n").slice(1);
  return lines
    .map((line) => {
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
      if (match) {
        return {
          function: match[1],
          filename: match[2],
          lineno: parseInt(match[3], 10),
          colno: parseInt(match[4], 10),
        };
      }
      const match2 = line.match(/at\s+(.+?):(\d+):(\d+)/);
      if (match2) {
        return {
          filename: match2[1],
          lineno: parseInt(match2[2], 10),
          colno: parseInt(match2[3], 10),
        };
      }
      return null;
    })
    .filter(Boolean)
    .reverse();
}
