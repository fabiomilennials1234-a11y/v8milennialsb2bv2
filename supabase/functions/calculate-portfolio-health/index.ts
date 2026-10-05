/**
 * calculate-portfolio-health — Cron job that recalculates health scores for
 * all active upsell clients across orgs with customer_portfolio feature enabled.
 *
 * Schedule: pg_cron `21 6,11-23/2 * * *` via pg_net (invoke_calculate_portfolio_health).
 * Auth: x-cron-secret header.
 *
 * I/O em lote (incidente 2026-10-05: o N+1 por cliente fazia ~4.500 req REST
 * por execução e derrubou o compute Small por OOM). Por org:
 *
 *   1. `portfolio_health_inputs` (keyset de 500) → clientes + pedidos aprovados
 *      + engajamento + último incoming; na 1ª página, os campos da org.
 *   2. `computeClientHealth` em memória (_shared/portfolio-health.ts) — o
 *      score continua em TS, idêntico ao de antes.
 *   3. `portfolio_health_apply` → numa transação: UPDATE só onde mudou,
 *      snapshot do dia, resolve/cria alertas; devolve os alertas CRIADOS.
 *   4. Só depois do commit, só para os alertas criados: notificação WhatsApp
 *      ao vendedor (crítico + flag da org + closer) e `recompra_atrasada`.
 *
 * Orçamento: 2 req de gating + 2 por página + raras por alerta novo.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { fireTrigger } from "../_shared/workflow-trigger.ts";
import { shouldFireRetentionTrigger, type RetentionAgent } from "../_shared/retention-gate.ts";
import { resolveInstance, sendTextViaInstance } from "../_shared/whatsapp-dispatch.ts";
import {
  applyRowFrom,
  computeClientHealth,
  healthInputFromRow,
  orgAvgTicketFrom,
  type ClientHealthResult,
  type DetectedSignal,
  type PortfolioApplyRow,
  type PortfolioInputsClient,
  type PortfolioInputsOrg,
} from "../_shared/portfolio-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/**
 * Clientes por página. service_role herda statement_timeout=8s do
 * authenticator; o EXPLAIN do inputs para a maior org (667 clientes) custou
 * 7074 — uma página de 500 cabe com folga.
 */
const PAGE_SIZE = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

type Supabase = SupabaseClient;

interface InputsPage {
  org: PortfolioInputsOrg | null;
  clients: PortfolioInputsClient[];
}

interface InsertedAlert {
  id: string;
  client_id: string;
  signal_index: number;
  alert_type: string;
  severity: string;
  metadata: Record<string, unknown>;
}

interface ApplyResult {
  updated: number;
  snapshots: number;
  resolved: number;
  inserted: InsertedAlert[];
}

interface OrgStats {
  processed: number;
  /** clientes cujo cálculo ou gravação falhou */
  failed: number;
  /** a leitura (portfolio_health_inputs) falhou: a org parou no meio */
  inputsFailed: boolean;
}

interface OrgSettings {
  orgAvgTicket: number;
  defaultCycleDays?: number;
  whatsappAlertsEnabled: boolean;
  retentionAgent: RetentionAgent | null;
}

interface Computed {
  client: PortfolioInputsClient;
  result: ClientHealthResult;
}

function orgSettingsFrom(org: PortfolioInputsOrg | null): OrgSettings {
  return {
    orgAvgTicket: orgAvgTicketFrom(org?.approved_sum, org?.approved_count),
    defaultCycleDays: org?.default_reorder_cycle_days ?? undefined,
    whatsappAlertsEnabled: org?.whatsapp_alerts_enabled === true,
    retentionAgent: org?.retention_config
      ? { retention_config: org.retention_config as RetentionAgent["retention_config"] }
      : null,
  };
}

// ─── Efeitos externos de um alerta CRIADO ────────────────────────────────────
//
// Mesma regra de antes (syncAlerts), mas só roda depois do commit do apply e só
// para o que o apply devolveu como inserido. Ordem: cliente da página, depois
// índice do sinal em detectSignals — o rate limit de 1 notificação/cliente/dia
// continua pegando o primeiro crítico, como antes.

async function notifyCloser(
  supabase: Supabase,
  orgId: string,
  { client, result }: Computed,
  alert: InsertedAlert,
  signal: DetectedSignal,
  now: Date,
): Promise<void> {
  try {
    // Rate limit: 1 notificação por cliente por dia
    const { data: rateCheck } = await supabase.rpc("check_rate_limit", {
      p_key: `portfolio_alert:${client.id}`,
      p_max_requests: 1,
      p_window_seconds: 86400,
    });
    // check_rate_limit é RETURNS TABLE: o PostgREST devolve ARRAY de linhas.
    // Ler `.allowed` direto do array dava sempre undefined → alerta nunca saía.
    const allowance = Array.isArray(rateCheck) ? rateCheck[0] : rateCheck;
    if (allowance?.allowed !== true) return;

    const { data: closer } = await supabase
      .from("team_members")
      .select("phone, name")
      .eq("id", client.closer_id)
      .maybeSingle();
    if (!closer?.phone) return;

    const instance = await resolveInstance(supabase, orgId, { requireConnected: true });
    if (!instance) return;

    const segment = result.update.segment;
    const msg = `⚠️ *Alerta Carteira*\n\nCliente *${client.name}* (${segment.toUpperCase()}) precisa de atenção.\n\n${signal.title}\n${signal.description ?? ""}\n\nHealth Score: ${result.update.health_score}/100`;

    const sent = await sendTextViaInstance(supabase, instance, closer.phone, msg, {
      trackSource: "portfolio_alert",
      trackId: client.id,
    });

    if (sent.success) {
      await supabase
        .from("client_alerts")
        .update({ notified_at: now.toISOString() })
        .eq("id", alert.id);
    }
  } catch (notifErr) {
    console.error(
      `[portfolio-health] Failed to send WhatsApp alert for client ${client.id}:`,
      notifErr,
    );
  }
}

async function fireReorderTrigger(
  supabase: Supabase,
  orgId: string,
  { client, result }: Computed,
  alert: InsertedAlert,
  signal: DetectedSignal,
  retentionAgent: RetentionAgent | null,
  now: Date,
): Promise<void> {
  if (!client.lead_id) return;
  try {
    // Retention gate: config do agente de retenção antes de disparar
    let lastDispatchAt: Date | null = null;
    if (retentionAgent?.retention_config?.max_frequency_days) {
      const { data: lastDispatch } = await supabase
        .from("outbound_dispatch_log")
        .select("dispatched_at")
        .eq("lead_id", client.lead_id)
        .order("dispatched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastDispatch?.dispatched_at) lastDispatchAt = new Date(lastDispatch.dispatched_at);
    }

    const gate = shouldFireRetentionTrigger({
      retentionAgent,
      alertSeverity: alert.severity,
      lastDispatchAt,
      now,
    });

    if (!gate.fire) {
      console.log(
        `[portfolio-health] Retention gate suppressed recompra_atrasada for lead ${client.lead_id}: ${gate.reason}`,
      );
      return;
    }

    await fireTrigger({
      supabase,
      organizationId: orgId,
      triggerType: "recompra_atrasada",
      leadId: client.lead_id,
      context: {
        client_id: client.id,
        days_overdue: signal.metadata.daysOverdue,
        cycle_days: signal.metadata.cycleDays,
        health_score: result.update.health_score,
        segment: result.update.segment,
      },
    });
  } catch (err) {
    console.error(
      `[portfolio-health] Failed to fire recompra_atrasada trigger for lead ${client.lead_id}:`,
      err,
    );
  }
}

async function runAlertEffects(
  supabase: Supabase,
  orgId: string,
  computed: Computed[],
  inserted: InsertedAlert[],
  settings: OrgSettings,
  now: Date,
): Promise<void> {
  if (inserted.length === 0) return;

  const position = new Map(computed.map((c, i) => [c.client.id, i]));
  const ordered = [...inserted].sort(
    (a, b) =>
      (position.get(a.client_id) ?? 0) - (position.get(b.client_id) ?? 0) ||
      a.signal_index - b.signal_index,
  );

  for (const alert of ordered) {
    const idx = position.get(alert.client_id);
    if (idx === undefined) continue; // apply só devolve cliente do payload
    const entry = computed[idx];
    const signal = entry.result.signals[alert.signal_index];
    if (!signal || signal.type !== alert.alert_type) continue;

    if (settings.whatsappAlertsEnabled && alert.severity === "critical" && entry.client.closer_id) {
      await notifyCloser(supabase, orgId, entry, alert, signal, now);
    }

    if (alert.alert_type === "reorder_overdue") {
      await fireReorderTrigger(supabase, orgId, entry, alert, signal, settings.retentionAgent, now);
    }
  }
}

// ─── Per-org processor ───────────────────────────────────────────────────────

async function processOrg(
  supabase: Supabase,
  orgId: string,
  now: Date,
): Promise<OrgStats> {
  const stats: OrgStats = { processed: 0, failed: 0, inputsFailed: false };
  const orgT0 = Date.now();
  let settings: OrgSettings | null = null;
  let after: string | null = null;

  while (true) {
    const { data: page, error: inputsError } = await supabase.rpc("portfolio_health_inputs", {
      p_org_id: orgId,
      p_after: after,
      p_limit: PAGE_SIZE,
    });

    if (inputsError || !page) {
      console.error(
        `[calculate-portfolio-health] inputs failed for org ${orgId}:`,
        inputsError ?? "empty response",
      );
      // Todas as leituras da org estão num statement só (timeout de 8 s da
      // service_role): falhar aqui deixa a org — ou o resto dela — sem
      // recálculo. Marca para o run sair como `error`, nunca `success` mudo.
      stats.inputsFailed = true;
      break;
    }

    const { org, clients } = page as InputsPage;
    if (settings === null) settings = orgSettingsFrom(org);
    if (!clients || clients.length === 0) break;

    const computed: Computed[] = [];
    for (const client of clients) {
      try {
        const result = computeClientHealth(healthInputFromRow(client), settings, now);
        computed.push({ client, result });
      } catch (err) {
        stats.failed++;
        console.warn(`[calculate-portfolio-health] client ${client.id} failed:`, err);
      }
    }

    if (computed.length > 0) {
      const payload: PortfolioApplyRow[] = computed.map((c) => applyRowFrom(c.client.id, c.result));
      const { data: applied, error: applyError } = await supabase.rpc("portfolio_health_apply", {
        p_org_id: orgId,
        p_now: now.toISOString(),
        p_results: payload,
      });

      if (applyError || !applied) {
        stats.failed += computed.length;
        console.error(
          `[calculate-portfolio-health] apply failed for org ${orgId}:`,
          applyError ?? "empty response",
        );
      } else {
        stats.processed += computed.length;
        await runAlertEffects(
          supabase,
          orgId,
          computed,
          (applied as ApplyResult).inserted ?? [],
          settings,
          now,
        );
      }
    }

    if (clients.length < PAGE_SIZE) break;
    after = clients[clients.length - 1].id;
  }

  const orgDurationMs = Date.now() - orgT0;
  console.log(
    `[calculate-portfolio-health] org ${orgId}: ${stats.processed} ok, ${stats.failed} failed, ${orgDurationMs}ms`,
  );

  return stats;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(
  withErrorBoundary("calculate-portfolio-health", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({ "Content-Type": "application/json" });

    // Auth
    const cronSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const t0 = Date.now();

    // Find orgs with customer_portfolio enabled (explicit org override)
    const { data: explicitEnabled } = await supabase
      .from("organization_features")
      .select("organization_id")
      .eq("feature_key", "customer_portfolio")
      .eq("enabled", true);

    // Check if feature is default-enabled
    const { data: flagRow } = await supabase
      .from("feature_flags")
      .select("default_enabled")
      .eq("key", "customer_portfolio")
      .maybeSingle();

    const defaultEnabled = flagRow?.default_enabled ?? false;

    // Collect target org IDs
    let targetOrgIds: string[];

    if (defaultEnabled) {
      // All orgs except those explicitly disabled
      const { data: explicitDisabled } = await supabase
        .from("organization_features")
        .select("organization_id")
        .eq("feature_key", "customer_portfolio")
        .eq("enabled", false);

      const disabledSet = new Set(
        (explicitDisabled ?? []).map((r: { organization_id: string }) => r.organization_id),
      );

      const { data: allOrgs } = await supabase
        .from("organizations")
        .select("id");

      targetOrgIds = (allOrgs ?? [])
        .map((r: { id: string }) => r.id)
        .filter((id: string) => !disabledSet.has(id));
    } else {
      // Only orgs with explicit opt-in
      targetOrgIds = (explicitEnabled ?? []).map(
        (r: { organization_id: string }) => r.organization_id,
      );
    }

    if (targetOrgIds.length === 0) {
      await logRuntime({
        module: "carteira",
        action: "run",
        status: "skipped",
        payloadSnapshot: { reason: "no orgs with customer_portfolio enabled" },
      });
      return new Response(
        JSON.stringify({ skipped: true, reason: "no enabled orgs" }),
        { status: 200, headers },
      );
    }

    // Process all orgs
    const summary: Record<string, OrgStats> = {};
    let totalProcessed = 0;
    let totalFailed = 0;
    let orgsFailed = 0;

    for (const orgId of targetOrgIds) {
      const orgStats = await processOrg(supabase, orgId, now);
      summary[orgId] = orgStats;
      totalProcessed += orgStats.processed;
      totalFailed += orgStats.failed;
      if (orgStats.inputsFailed) orgsFailed++;
    }

    const durationMs = Date.now() - t0;

    await logRuntime({
      module: "carteira",
      action: "run",
      status: totalFailed === 0 && orgsFailed === 0 ? "success" : "error",
      payloadSnapshot: {
        orgs: targetOrgIds.length,
        totalProcessed,
        totalFailed,
        orgsFailed,
        durationMs,
      },
      errorMessage:
        [
          totalFailed > 0 ? `${totalFailed} client(s) failed health calculation` : null,
          orgsFailed > 0 ? `${orgsFailed} org(s) failed reading inputs` : null,
        ].filter(Boolean).join("; ") || undefined,
      durationMs,
    });

    console.log(
      `[calculate-portfolio-health] done — ${targetOrgIds.length} orgs, ` +
      `${totalProcessed} ok, ${totalFailed} failed, ${orgsFailed} org(s) failed, ${durationMs}ms`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        orgs: targetOrgIds.length,
        totalProcessed,
        totalFailed,
        orgsFailed,
        durationMs,
        summary,
      }),
      { status: 200, headers },
    );
  }),
);
