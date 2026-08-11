/**
 * cron-health-check — detect CRON_SECRET drift before it silently halts automations.
 *
 * Why this exists:
 *   - pg_cron invokes edge functions via pg_net using a secret from `cron_config.cron_secret`.
 *   - Edge functions validate that secret against the `CRON_SECRET` env var.
 *   - If either side rotates without the other, pg_net keeps firing requests
 *     that the edge function rejects with 401. pg_net swallows the failure
 *     (RAISE WARNING). All workflow / dispatch automations stop with NO alert.
 *
 * What this does:
 *   - Reads `cron_config.cron_secret` (table) and the local `CRON_SECRET` env.
 *   - Issues a probe call to `process-workflow-executions` with the table secret.
 *   - If response != 200 → log error to runtime_logs ("CRON secret drift").
 *   - Vigia o ENVIO do alerta do `infra-watchdog` (`module='job_monitor'`,
 *     `action='watchdog_alert'`, `status='error'`). Ver `watchdog-delivery.ts`.
 *
 * Por que a vigilância do watchdog mora AQUI e não nele: o watchdog vigiando o
 * próprio envio é auto-referência — se ele cair, os dois lados calam juntos.
 * Aqui é outra edge function, disparada por OUTRO job de pg_cron
 * (`invoke_cron_health_check()` vs `invoke_infra_watchdog()`), sem encadeamento
 * entre as duas em nenhuma direção.
 *
 * Schedule: every 5 minutes via pg_cron (see migration 20261001000003).
 * Auth: same x-cron-secret / service_role pattern as other cron-driven functions.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { runHealthCheck, PROBE_TIMEOUT_MS } from "./health-check.ts";
import { WATCHDOG_DELIVERY_LOOKBACK_MINUTES } from "./watchdog-delivery.ts";
import { requireCronAuth } from "../_shared/auth.ts";

/**
 * Lê as falhas de ENVIO do alerta do infra-watchdog.
 *
 * O watchdog grava aqui quando o WhatsApp do alerta não sai — e chama isso de
 * "último recurso". Sem alguém lendo, o último recurso é uma prateleira muda.
 * Quem lê é esta função, que roda por OUTRO job de pg_cron: watchdog vigiando o
 * próprio envio calaria junto com ele.
 */
function buildWatchdogFailureFetcher(supabase: ReturnType<typeof createClient>) {
  return async () => {
    const desde = new Date(Date.now() - WATCHDOG_DELIVERY_LOOKBACK_MINUTES * 60_000).toISOString();
    const { data, error } = await supabase
      .from("runtime_logs")
      .select("created_at")
      .eq("module", "job_monitor")
      .eq("action", "watchdog_alert")
      .eq("status", "error")
      .gte("created_at", desde)
      .order("created_at", { ascending: true })
      .limit(500);

    // Erro de consulta NÃO vira lista vazia: "não sei" e "não há falha" são
    // coisas diferentes, e confundir as duas é o defeito que este código ataca.
    if (error) throw new Error(error.message);
    return (data ?? []) as { created_at: string }[];
  };
}

function buildProbe(supabaseUrl: string): (secret: string) => Promise<number | null> {
  return async (secret: string) => {
    if (!supabaseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/process-workflow-executions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": secret,
        },
        body: JSON.stringify({ mode: "noop_probe" }),
        signal: controller.signal,
      });
      return res.status;
    } catch (err) {
      console.error("[cron-health-check] probe fetch threw:", err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

function buildTableSecretFetcher(
  supabase: ReturnType<typeof createClient>,
): () => Promise<string | null> {
  return async () => {
    const { data, error } = await supabase
      .from("cron_config")
      .select("value")
      .eq("key", "cron_secret")
      .maybeSingle();
    if (error || !data?.value) return null;
    return String(data.value);
  };
}

Deno.serve(
  withErrorBoundary("cron-health-check", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (!requireCronAuth(req).authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const report = await runHealthCheck({
      fetchTableSecret: buildTableSecretFetcher(supabase),
      envSecret: CRON_SECRET,
      probe: buildProbe(SUPABASE_URL),
      fetchWatchdogDeliveryFailures: buildWatchdogFailureFetcher(supabase),
    });

    await logRuntime({
      module: "workflow",
      action: "cron_health_check",
      status: report.healthy ? "success" : "error",
      errorMessage: report.healthy ? undefined : report.message,
      payloadSnapshot: {
        env_secret_present: report.env_secret_present,
        table_secret_present: report.table_secret_present,
        secrets_match: report.secrets_match,
        edge_probe_status: report.edge_probe_status,
        // Quantas e desde quando — "houve falha" não diz se é um tropeço ou
        // uma semana de silêncio.
        watchdog_delivery_failures: report.watchdog_delivery?.count ?? 0,
        watchdog_delivery_oldest_at: report.watchdog_delivery?.oldest_at ?? null,
      },
    });

    if (!report.healthy) {
      console.error("[cron-health-check] UNHEALTHY:", report.message);
    }

    return new Response(JSON.stringify(report), { status: 200, headers });
  }),
);
