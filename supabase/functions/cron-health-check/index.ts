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
import { requireCronAuth } from "../_shared/auth.ts";

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


/**
 * Drift de segredo de cron para o sino de quem opera a plataforma (#1886).
 *
 * Detectar não é alertar: até aqui esta função só escrevia em runtime_logs, que
 * ninguém lê — e o incidente que ela existe para pegar para TODAS as automações
 * em silêncio.
 *
 * O segredo é global, não por organização, então o Aviso vai para a organização
 * que OPERA a plataforma, e só para ela: nenhum administrador de cliente pode
 * consertar isto, e 30 sinos tocando por um incidente nosso é ruído, não
 * transparência. Sem AVISOS_OPS_ORG_ID configurado, nada é emitido — e isso é
 * exatamente o defeito de hoje, então a variável é parte da entrega, não um
 * opcional.
 */
async function avisarOperacao(
  supabase: ReturnType<typeof createClient>,
  mensagem: string,
): Promise<void> {
  const orgOperacao = Deno.env.get("AVISOS_OPS_ORG_ID") ?? "";
  if (!orgOperacao) {
    console.warn("[cron-health-check] AVISOS_OPS_ORG_ID ausente — drift sem destinatário");
    return;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.rpc("fn_emit_aviso_admins", {
    p_organization_id: orgOperacao,
    p_type: "cron_drift",
    // Um Aviso por dia: enquanto ninguém lê, o contador cresce em vez de a
    // caixa encher — o cron roda de 5 em 5 minutos.
    p_group_key: `cron_drift:${hoje}`,
    p_title: "O motor de automações parou",
    p_description: mensagem,
    p_link: "/automacoes",
  });

  if (error) {
    console.error("[cron-health-check] aviso de drift falhou:", error.message);
  }
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
      },
    });

    if (!report.healthy) {
      console.error("[cron-health-check] UNHEALTHY:", report.message);
      await avisarOperacao(supabase, report.message);
    }

    return new Response(JSON.stringify(report), { status: 200, headers });
  }),
);
