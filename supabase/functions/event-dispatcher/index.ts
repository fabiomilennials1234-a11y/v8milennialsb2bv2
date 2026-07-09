/**
 * event-dispatcher — slice 19 event-bus piloto
 *
 * Consome eventos pending em `domain_events`, faz fan-out para handlers
 * registrados em `_shared/events/registry.ts`, marca status final.
 *
 * Schedule: pg_cron 1/min (migration `<ts>_event_dispatcher_cron.sql`).
 * Auth: x-cron-secret.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { dispatchPending } from "../_shared/events/dispatch.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const DEFAULT_BATCH_SIZE = 50;

Deno.serve(
  withErrorBoundary("event-dispatcher", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: withSecurityHeaders(corsHeaders) });
    }

    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    const provided = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !provided || !timingSafeCompare(provided, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
      });
    }

    let batchSize = DEFAULT_BATCH_SIZE;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (typeof body?.batchSize === "number" && body.batchSize > 0 && body.batchSize <= 500) {
          batchSize = body.batchSize;
        }
      } catch {
        // body opcional — ignora parse error
      }
    }

    const t0 = Date.now();
    const result = await dispatchPending({ batchSize });
    const durationMs = Date.now() - t0;

    console.log(
      `[event-dispatcher] scanned=${result.scanned} dispatched=${result.dispatched} failed=${result.failed} duration=${durationMs}ms`,
    );

    return new Response(JSON.stringify({ ...result, durationMs }), {
      status: 200,
      headers,
    });
  }),
);
