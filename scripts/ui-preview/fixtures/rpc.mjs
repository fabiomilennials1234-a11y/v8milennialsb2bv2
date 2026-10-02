/**
 * RPC fixtures (`/rest/v1/rpc/<fn>`). Handler signature: (args, fx, { schema }).
 * Unlisted RPCs fall back to an empty value shaped by their declared return
 * type in types.ts (array → [], boolean is_/can_/has_ → true, else null).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { pipelineRpcs } from "./rpc-pipeline.mjs";
import { analyticsRpcs } from "./rpc-analytics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Behaviour toggles that change HOW a screen works (not whether it is sold).
// Left off so the preview matches a typical tenant.
const BEHAVIOUR_FLAGS = new Set(["white_label", "user_write_instance_strict", "unified_message_gateway", "merged_opportunity_funnel"]);

function featureKeys() {
  const text = readFileSync(resolve(ROOT, "src/modules/platform/lib/feature-catalog.generated.ts"), "utf8");
  const block = text.match(/export type FeatureKey =([\s\S]*?);/)?.[1] ?? "";
  return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}
const FEATURES = Object.fromEntries(featureKeys().map((k) => [k, !BEHAVIOUR_FLAGS.has(k)]));
const LIMITS = {
  max_leads: -1,
  max_users: 25,
  max_campaigns: -1,
  max_copilot_agents: 10,
  max_whatsapp_instances: 10,
  max_funnels: -1,
  max_documents_per_agent: 50,
  max_active_campaigns: -1,
  max_custom_funnels: -1,
  max_temporary_funnels: 10,
};

// ───────────────────────── chat helpers ─────────────────────────
function threads(fx, instanceIds) {
  const byKey = new Map();
  for (const m of fx.db.whatsapp_messages) {
    if (instanceIds && !instanceIds.includes(m.instance_id)) continue;
    if (m.deleted_at) continue;
    const k = `${m.instance_id}|${m.normalized_phone}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(m);
  }
  const rows = [];
  for (const msgs of byKey.values()) {
    msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const last = msgs[msgs.length - 1];
    const lead = fx.db.leads.find((l) => l.id === last.lead_id);
    const conv = fx.db.conversations.find((c) => c.lead_id === last.lead_id);
    const wconv = fx.db.whatsapp_conversations.find((c) => c.instance_id === last.instance_id && c.normalized_phone === last.normalized_phone);
    let unread = 0;
    for (let i = msgs.length - 1; i >= 0 && msgs[i].direction === "incoming"; i--) unread++;
    rows.push({
      instance_id: last.instance_id,
      phone_number: last.phone_number,
      normalized_phone: last.normalized_phone,
      push_name: msgs.find((m) => m.direction === "incoming")?.push_name ?? lead?.name ?? null,
      last_message: last.content,
      last_message_time: last.timestamp,
      last_message_direction: last.direction,
      last_message_sent_source: last.sent_source,
      lead_id: last.lead_id,
      is_group: false,
      conversation_id: conv?.id ?? null,
      archived_at: wconv?.archived_at ?? null,
      unread_count: unread,
    });
  }
  return rows.sort((a, b) => b.last_message_time.localeCompare(a.last_message_time));
}

export const rpcHandlers = {
  // ── chat ──
  get_whatsapp_conversation_list_multi: (a, fx) => threads(fx, a.p_instances ?? null),
  get_whatsapp_conversation_list: (a, fx) => threads(fx, a.p_instance ? [a.p_instance] : null),
  get_official_whatsapp_conversation_list_multi: () => [],
  get_social_conversation_list: () => [],
  get_unread_counts: (a, fx) =>
    threads(fx, a.p_instance_ids ?? null)
      .filter((t) => t.unread_count > 0)
      .map((t) => ({ instance_id: t.instance_id, normalized_phone: t.normalized_phone, unread: t.unread_count })),
  whatsapp_chip_instance_ids: (a) => [a.p_instance],
  whatsapp_thread_manifest: (a, fx) => {
    const ids = a.p_instance_ids ?? [];
    const msgs = fx.db.whatsapp_messages
      .filter((m) => (ids.length ? ids.includes(m.instance_id) : true) && m.normalized_phone === a.p_phone && !m.deleted_at)
      .sort((x, y) => x.timestamp.localeCompare(y.timestamp))
      .slice(-100);
    const manifest = msgs.map((m) => ({ id: m.id, revision: m.timestamp }));
    return { fingerprint: `fp-${msgs.length}-${msgs.at(-1)?.id ?? "0"}`, unchanged: false, manifest };
  },
  mark_conversation_read: () => null,
  get_phone_ai_status: (a, fx) => ({ ai_disabled: false, source: "default", organization_id: fx.orgId, normalized_phone: a.p_phone, lead_id: null }),
  get_lead_ai_status: () => ({ ai_disabled: false, source: "default" }),
  get_conversas_do_lead: (a, fx) => {
    const t = threads(fx, null).filter((r) => r.normalized_phone === a.p_phone || r.phone_number === a.p_phone);
    return t.map((r) => {
      const inst = fx.db.whatsapp_instances.find((i) => i.id === r.instance_id);
      return {
        instance_id: r.instance_id,
        instance_name: inst?.instance_name ?? null,
        instance_status: inst?.status ?? "connected",
        last_message_at: r.last_message_time,
        last_message_content: r.last_message,
        last_message_direction: r.last_message_direction,
      };
    });
  },

  org_get_features_and_limits: () => ({ features: FEATURES, limits: LIMITS, plan_name: "enterprise" }),
  org_get_subscription_status: (_a, fx) => ({
    status: "active",
    plan: "enterprise",
    expires_at: fx.org.subscription_expires_at,
    is_valid: true,
    days_remaining: 200,
    grace_remaining: null,
    is_overdue: false,
    is_blocked: false,
  }),
  org_get_seat_usage: (_a, fx) => ({ used: fx.db.team_members.length, included: 25, extra: 0 }),
  org_resolve_all_quotas: (_a, fx) => {
    const usage = {
      max_leads: fx.db.leads.length,
      max_users: fx.db.team_members.length,
      max_copilot_agents: fx.db.copilot_agents.length,
      max_whatsapp_instances: fx.db.whatsapp_instances.length,
      max_custom_funnels: fx.db.pipelines.length,
    };
    return Object.fromEntries(
      Object.entries(LIMITS).map(([k, lim]) => {
        const used = usage[k] ?? 0;
        const unlimited = lim === -1;
        return [k, { plan_base: lim, purchased_addons: 0, admin_adjustment: 0, effective_limit: lim, current_usage: used, is_unlimited: unlimited, can_add: unlimited || used < lim, remaining: unlimited ? -1 : Math.max(0, lim - used) }];
      }),
    );
  },
  is_master_user: (_a, fx) => fx.isMaster,
  get_my_organization_ids: (_a, fx) => [fx.orgId],
  ...pipelineRpcs,
  ...analyticsRpcs(threads),
};
