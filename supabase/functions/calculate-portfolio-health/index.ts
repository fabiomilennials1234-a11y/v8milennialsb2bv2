/**
 * calculate-portfolio-health — Cron job that recalculates health scores for
 * all active upsell clients across orgs with customer_portfolio feature enabled.
 *
 * Schedule: triggered by pg_cron (e.g. every 30 minutes) via pg_net.
 * Auth: x-cron-secret header.
 *
 * Per client:
 *  - Fetches all orders, sorts by sold_at ASC
 *  - Computes cycle days (avg gap between orders, default 30)
 *  - Calculates recency / frequency / ticket scores
 *  - Engagement defaults to 50 (neutral) — will be enhanced later
 *  - New clients (< 3 orders) get health_score = 70 (neutral)
 *  - Upserts health columns back into upsell_clients
 *  - Detects signals and syncs client_alerts (create new, resolve stale)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { fireTrigger } from "../_shared/workflow-trigger.ts";
import {
  calculateFrequencyScore,
  calculateHealthScore,
  calculateRecencyScore,
  calculateTicketScore,
  calculateEngagementScore,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
  type DetectedSignal,
  type ProductFrequency,
} from "../_shared/portfolio-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const BATCH_SIZE = 100;
const DEFAULT_CYCLE_DAYS = 30;
const ENGAGEMENT_DEFAULT = 50; // neutral — enhanced in future
const NEW_CLIENT_SCORE = 70;    // < 3 orders → neutral start

// ─── Types ───────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  sale_value: number;
  sold_at: string;
  product_name: string;
}

interface ClientRow {
  id: string;
  organization_id: string;
  lead_id: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function computeCycleDays(orders: Order[]): number {
  if (orders.length < 2) return DEFAULT_CYCLE_DAYS;
  const sorted = [...orders].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime(),
  );
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(new Date(sorted[i - 1].sold_at), new Date(sorted[i].sold_at)));
  }
  return Math.max(1, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length));
}

function productFrequencies(orders: Order[]): ProductFrequency[] {
  if (orders.length === 0) return [];
  const counts: Record<string, number> = {};
  for (const o of orders) {
    counts[o.product_name] = (counts[o.product_name] ?? 0) + 1;
  }
  return Object.entries(counts).map(([productName, count]) => ({
    productName,
    appearsInPct: Math.round((count / orders.length) * 100),
  }));
}

// ─── Per-client processor ────────────────────────────────────────────────────

async function processClient(
  supabase: ReturnType<typeof createClient>,
  client: ClientRow,
  orgAvgTicket: number,
  now: Date,
): Promise<{ success: boolean; error?: string }> {
  // Fetch all orders for this client
  const { data: orders, error: ordersError } = await supabase
    .from("upsell_orders")
    .select("id, sale_value, sold_at, product_name")
    .eq("client_id", client.id)
    .order("sold_at", { ascending: true });

  if (ordersError) {
    return { success: false, error: ordersError.message };
  }

  // Fetch engagement data (requires lead_id)
  let engagementScore = ENGAGEMENT_DEFAULT;
  let daysSinceLastIncoming: number | null = null;

  if (client.lead_id) {
    const { data: ctxSummary } = await supabase
      .from("conversation_context_summary")
      .select("engagement_score")
      .eq("lead_id", client.lead_id)
      .maybeSingle();

    const { data: lastIncoming } = await supabase
      .from("whatsapp_messages")
      .select("timestamp")
      .eq("lead_id", client.lead_id)
      .eq("direction", "incoming")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    daysSinceLastIncoming = lastIncoming
      ? Math.round(daysBetween(new Date(lastIncoming.timestamp), now))
      : null;

    engagementScore = calculateEngagementScore(
      ctxSummary?.engagement_score ?? null,
      daysSinceLastIncoming,
    );
  }

  const orderList: Order[] = orders ?? [];
  const orderCount = orderList.length;
  const cycleDays = computeCycleDays(orderList);

  // Last order date + recency
  const sorted = [...orderList].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime(),
  );
  const lastOrder = sorted.at(-1);
  const lastOrderAt = lastOrder ? new Date(lastOrder.sold_at) : null;
  const daysSinceLastOrder = lastOrderAt
    ? Math.round(daysBetween(lastOrderAt, now))
    : 999;

  // Ticket stats
  const totalValue = orderList.reduce((s, o) => s + Number(o.sale_value), 0);
  const avgTicket = orderCount > 0 ? totalValue / orderCount : 0;
  const lifetimeValue = totalValue;

  // Recency period = last 90 days vs historical base
  const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recent90 = orderList.filter((o) => new Date(o.sold_at) >= cutoff90);
  const recentCount = recent90.length;
  const historicalCount = Math.max(1, Math.ceil((orderCount * 90) / 365)); // expected in 90d

  // Last-3 tickets for declining detection
  const lastThreeTickets = sorted.slice(-3).map((o) => Number(o.sale_value));

  // Compute dimensions
  const recencyScore = lastOrderAt
    ? calculateRecencyScore(daysSinceLastOrder, cycleDays)
    : 0;
  const frequencyScore = calculateFrequencyScore(recentCount, historicalCount);

  // Ticket: recent avg vs historical avg
  const recentAvg =
    recent90.length > 0
      ? recent90.reduce((s, o) => s + Number(o.sale_value), 0) / recent90.length
      : 0;
  const ticketScore = calculateTicketScore(recentAvg, avgTicket || 1);

  const dims = {
    recency: recencyScore,
    frequency: frequencyScore,
    ticket: ticketScore,
    engagement: engagementScore,
  };

  // New clients get a neutral score
  const healthScore =
    orderCount < 3 ? NEW_CLIENT_SCORE : calculateHealthScore(dims);

  const healthStatus = deriveHealthStatus(healthScore);
  const segment = deriveSegment(healthScore, avgTicket, orgAvgTicket, orderCount);
  const trend = deriveTrend(lastThreeTickets, avgTicket);

  // Next expected order
  const nextOrderExpected = lastOrderAt
    ? new Date(lastOrderAt.getTime() + cycleDays * 24 * 60 * 60 * 1000)
    : null;

  // Update upsell_clients
  const { error: updateError } = await supabase
    .from("upsell_clients")
    .update({
      health_score: healthScore,
      health_status: healthStatus,
      health_updated_at: now.toISOString(),
      segment,
      reorder_cycle_days: cycleDays,
      days_since_last_order: daysSinceLastOrder,
      last_order_at: lastOrderAt?.toISOString() ?? null,
      next_order_expected: nextOrderExpected?.toISOString() ?? null,
      order_count: orderCount,
      lifetime_value: lifetimeValue,
      avg_ticket: avgTicket || null,
      trend,
    })
    .eq("id", client.id);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Detect signals
  const pf = productFrequencies(orderList);
  const lastOrderProducts = lastOrder ? [lastOrder.product_name] : [];

  const signals: DetectedSignal[] = detectSignals({
    daysSinceLastOrder,
    cycleDays,
    lastThreeTickets,
    historicalAvgTicket: avgTicket,
    productFrequencies: pf,
    lastOrderProducts,
    daysSinceLastWhatsAppReply: daysSinceLastIncoming,
    lastNpsScore: null,               // not wired yet
  });

  // Sync alerts: resolve stale, create new
  await syncAlerts(supabase, client, signals, now, healthScore, segment);

  return { success: true };
}

// ─── Alert sync ──────────────────────────────────────────────────────────────

async function syncAlerts(
  supabase: ReturnType<typeof createClient>,
  client: ClientRow,
  signals: DetectedSignal[],
  now: Date,
  healthScore: number,
  segment: string,
): Promise<void> {
  // Fetch open alerts for this client
  const { data: openAlerts } = await supabase
    .from("client_alerts")
    .select("id, alert_type")
    .eq("client_id", client.id)
    .eq("is_resolved", false);

  const openByType = new Map<string, string>(); // type → alert id
  for (const a of openAlerts ?? []) {
    openByType.set(a.alert_type, a.id);
  }

  const activeTypes = new Set(signals.map((s) => s.type));

  // Resolve alerts whose signal no longer fires
  const toResolve: string[] = [];
  for (const [type, id] of openByType) {
    if (!activeTypes.has(type)) {
      toResolve.push(id);
    }
  }
  if (toResolve.length > 0) {
    await supabase
      .from("client_alerts")
      .update({ is_resolved: true, resolved_at: now.toISOString() })
      .in("id", toResolve);
  }

  // Create new alerts (skip already-open ones)
  for (const signal of signals) {
    if (openByType.has(signal.type)) continue; // already open
    const { error: insertError } = await supabase.from("client_alerts").insert({
      organization_id: client.organization_id,
      client_id: client.id,
      alert_type: signal.type,
      severity: signal.severity,
      title: signal.title,
      description: signal.description,
      metadata: signal.metadata,
    });

    if (insertError) {
      console.error(
        `[portfolio-health] Failed to insert alert for client ${client.id}:`,
        insertError,
      );
      continue;
    }

    // Fire workflow trigger for reorder_overdue signal if lead exists
    if (signal.type === "reorder_overdue" && client.lead_id) {
      try {
        await fireTrigger({
          supabase,
          organizationId: client.organization_id,
          triggerType: "recompra_atrasada",
          leadId: client.lead_id,
          context: {
            client_id: client.id,
            days_overdue: signal.metadata.daysOverdue,
            cycle_days: signal.metadata.cycleDays,
            health_score: healthScore,
            segment,
          },
        });
      } catch (err) {
        console.error(
          `[portfolio-health] Failed to fire recompra_atrasada trigger for lead ${client.lead_id}:`,
          err,
        );
      }
    }
  }
}

// ─── Per-org processor ───────────────────────────────────────────────────────

async function processOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  now: Date,
): Promise<{ processed: number; failed: number }> {
  const stats = { processed: 0, failed: 0 };

  // Compute org-wide avg ticket for segmentation
  const { data: ticketData } = await supabase
    .from("upsell_orders")
    .select("sale_value")
    .eq("organization_id", orgId);

  const allValues = (ticketData ?? []).map((r: { sale_value: number }) => Number(r.sale_value));
  const orgAvgTicket =
    allValues.length > 0
      ? allValues.reduce((s: number, v: number) => s + v, 0) / allValues.length
      : 0;

  // Process active clients in batches
  let offset = 0;
  while (true) {
    const { data: clients, error: clientsError } = await supabase
      .from("upsell_clients")
      .select("id, organization_id, lead_id")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .range(offset, offset + BATCH_SIZE - 1);

    if (clientsError) {
      console.error(`[calculate-portfolio-health] clients query failed for org ${orgId}:`, clientsError);
      break;
    }

    const batch: ClientRow[] = clients ?? [];
    if (batch.length === 0) break;

    for (const client of batch) {
      const result = await processClient(supabase, client, orgAvgTicket, now);
      if (result.success) {
        stats.processed++;
      } else {
        stats.failed++;
        console.warn(
          `[calculate-portfolio-health] client ${client.id} failed: ${result.error}`,
        );
      }
    }

    if (batch.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return stats;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(
  withSentry("calculate-portfolio-health", async (req: Request): Promise<Response> => {
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
        module: "calculate-portfolio-health",
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
    const summary: Record<string, { processed: number; failed: number }> = {};
    let totalProcessed = 0;
    let totalFailed = 0;

    for (const orgId of targetOrgIds) {
      const orgStats = await processOrg(supabase, orgId, now);
      summary[orgId] = orgStats;
      totalProcessed += orgStats.processed;
      totalFailed += orgStats.failed;
    }

    const durationMs = Date.now() - t0;

    await logRuntime({
      module: "calculate-portfolio-health",
      action: "run",
      status: totalFailed === 0 ? "success" : "error",
      payloadSnapshot: {
        orgs: targetOrgIds.length,
        totalProcessed,
        totalFailed,
        durationMs,
      },
      errorMessage:
        totalFailed > 0
          ? `${totalFailed} client(s) failed health calculation`
          : undefined,
      durationMs,
    });

    console.log(
      `[calculate-portfolio-health] done — ${targetOrgIds.length} orgs, ` +
      `${totalProcessed} ok, ${totalFailed} failed, ${durationMs}ms`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        orgs: targetOrgIds.length,
        totalProcessed,
        totalFailed,
        durationMs,
        summary,
      }),
      { status: 200, headers },
    );
  }),
);
