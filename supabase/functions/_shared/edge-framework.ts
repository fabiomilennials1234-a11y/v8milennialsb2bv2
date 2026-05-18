/**
 * createEdgeFunction — unified handler framework for Supabase Edge Functions.
 *
 * Eliminates 15-25 lines of boilerplate per function:
 * CORS, security headers, OPTIONS 204, auth dispatch, Supabase client,
 * JSON parsing, error wrapping, method restriction.
 */

import { getCorsHeaders } from "./cors.ts";
import { withSecurityHeaders } from "./security-headers.ts";
import { timingSafeCompare } from "./auth.ts";
import { captureError } from "./sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AuthStrategy = "none" | "cron-secret" | "webhook-secret" | "jwt";

interface HandlerContext {
  req: Request;
  supabase: ReturnType<typeof createClient>;
  body: unknown;
  headers: Record<string, string>;
}

interface EdgeFunctionConfig {
  name: string;
  auth?: AuthStrategy;
  methods?: string[];
  handler: (ctx: HandlerContext) => Promise<unknown>;
}

export function createEdgeFunction(config: EdgeFunctionConfig): (req: Request) => Promise<Response> {
  const { name, auth = "none", methods, handler } = config;

  return async (req: Request): Promise<Response> => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

    try {
      if (methods && !methods.includes(req.method)) {
        return new Response(
          JSON.stringify({ error: `Method not allowed: ${req.method}` }),
          { status: 405, headers: jsonHeaders },
        );
      }

      const authResult = validateAuth(req, auth);
      if (!authResult.valid) {
        return new Response(
          JSON.stringify({ error: authResult.error || "Unauthorized" }),
          { status: 401, headers: jsonHeaders },
        );
      }

      let body: unknown = null;
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        try {
          const text = await req.text();
          if (text.trim()) {
            body = JSON.parse(text);
          }
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid JSON body" }),
            { status: 400, headers: jsonHeaders },
          );
        }
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const ctx: HandlerContext = { req, supabase, body, headers: corsHeaders };
      const result = await handler(ctx);

      if (result instanceof Response) {
        return result;
      }

      return new Response(JSON.stringify(result), { status: 200, headers: jsonHeaders });
    } catch (error) {
      await captureError(error, { functionName: name }).catch(() => {});

      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: jsonHeaders },
      );
    }
  };
}

function validateAuth(req: Request, strategy: AuthStrategy): { valid: boolean; error?: string } {
  switch (strategy) {
    case "none":
      return { valid: true };

    case "cron-secret": {
      const secret = Deno.env.get("CRON_SECRET");
      const header = req.headers.get("x-cron-secret");
      if (!secret || !header || !timingSafeCompare(header, secret)) {
        return { valid: false, error: "Unauthorized: invalid cron secret" };
      }
      return { valid: true };
    }

    case "webhook-secret": {
      const secret = Deno.env.get("WEBHOOK_SECRET");
      const header = req.headers.get("x-webhook-secret") || req.headers.get("x-webhook-key");
      if (!secret || !header || !timingSafeCompare(header, secret)) {
        return { valid: false, error: "Unauthorized: invalid webhook secret" };
      }
      return { valid: true };
    }

    case "jwt": {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return { valid: false, error: "Unauthorized: missing Bearer token" };
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: "Unknown auth strategy" };
  }
}
