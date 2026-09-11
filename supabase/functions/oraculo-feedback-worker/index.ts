/** Retry dos alertas de invenção e entrega idempotente do resumo semanal. */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeCompare } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { processFeedbackWorker } from "../_shared/oraculo/feedback-worker.ts";
import { createFeedbackWorkerDeps } from "../_shared/oraculo/feedback-worker-store.ts";

Deno.serve(withErrorBoundary("oraculo-feedback-worker", async (req) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const secret = Deno.env.get("CRON_SECRET");
  const supplied = req.headers.get("x-cron-secret");
  if (!secret) return json({ error: "Server misconfiguration" }, 500);
  if (!supplied || !timingSafeCompare(supplied, secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (body.mode !== "alerts" && body.mode !== "weekly") {
    return json({ error: "mode must be alerts or weekly" }, 400);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const result = await processFeedbackWorker(body.mode, createFeedbackWorkerDeps(db));
  await logRuntime({
    module: "copilot",
    action: body.mode === "weekly" ? "feedback_weekly_digest" : "feedback_alert_dispatch",
    status: result.failed > 0 ? "error" : "success",
    payloadSnapshot: result,
  });
  return json({ ok: result.failed === 0, ...result });
}));
