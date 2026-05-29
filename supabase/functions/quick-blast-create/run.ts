/**
 * runQuickBlast — Quick Blast orchestration core (Module D).
 *
 * A Quick Blast IS a Mass Send (ADR-0002): same dispatch core, different entry
 * point and access policy. No role gate — any authenticated org member fires;
 * the org-level cap is the sole guardrail. RLS/org-scoped reads keep recipients
 * within the caller's organization.
 *
 * The dispatch fn is injected so this is testable without a provider/network.
 */
import { getOrgBlastCap } from "../_shared/quick-blast/org-cap.ts";
import { buildRecipients, type BlastLead } from "../_shared/quick-blast/recipients.ts";

export interface QuickBlastDeps {
  supabaseAdmin: { from: (t: string) => any };
  dispatch: (
    instance: any,
    input: {
      recipients: Array<{ number: string; text?: string }>;
      delayMin?: number;
      delayMax?: number;
      scheduledFor?: string;
      triggeredByUserId?: string | null;
      triggeredVia?: "ui" | "api" | "cron" | "workflow";
      trackSource?: string;
    },
  ) => Promise<{ sender_job_id: string; uazapi_sender_id: string }>;
}

export interface QuickBlastParams {
  orgId: string;
  userId: string;
  instance: { id: string; organization_id: string; provider?: string };
  leadIds: string[];
  message: string;
  delayMinMs?: number;
  delayMaxMs?: number;
  maxLeads?: number;
  scheduledFor?: string;
}

export interface QuickBlastResult {
  ok: boolean;
  sender_job_id?: string;
  uazapi_sender_id?: string;
  count: number;
  skipped: { noPhone: number; duplicates: number; overCap: number };
  error?: string;
}

const EMPTY_SKIPPED = { noPhone: 0, duplicates: 0, overCap: 0 };

export async function runQuickBlast(
  deps: QuickBlastDeps,
  params: QuickBlastParams,
): Promise<QuickBlastResult> {
  const { supabaseAdmin, dispatch } = deps;

  // Tenant guard: the chosen instance must belong to the caller's org.
  if (params.instance.organization_id !== params.orgId) {
    return { ok: false, count: 0, skipped: { ...EMPTY_SKIPPED }, error: "instance_org_mismatch" };
  }

  if (!params.message || params.message.trim().length === 0) {
    return { ok: false, count: 0, skipped: { ...EMPTY_SKIPPED }, error: "empty_message" };
  }
  if (!Array.isArray(params.leadIds) || params.leadIds.length === 0) {
    return { ok: false, count: 0, skipped: { ...EMPTY_SKIPPED }, error: "no_leads" };
  }

  // Org cap is the guardrail; per-blast max is clamped within it.
  const orgCap = await getOrgBlastCap(supabaseAdmin, params.orgId);
  const effectiveCap = params.maxLeads && params.maxLeads > 0
    ? Math.min(params.maxLeads, orgCap)
    : orgCap;

  // Org-scoped fetch — foreign-org lead ids are excluded by the org filter.
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, name, company, phone")
    .eq("organization_id", params.orgId)
    .in("id", params.leadIds);

  const baseLeads = (leads ?? []) as BlastLead[];

  // Left-join carteira data so {segmento}/{ticket_medio}/{dias_sem_pedido}/{ltv}
  // resolve when the lead is also a portfolio client. Absent → empty (Slice 2).
  const merged = await mergePortfolioData(supabaseAdmin, params.orgId, baseLeads);

  const { recipients, skipped } = buildRecipients(merged, {
    template: params.message,
    cap: effectiveCap,
  });

  if (recipients.length === 0) {
    return { ok: false, count: 0, skipped, error: "no_recipients" };
  }

  const { sender_job_id, uazapi_sender_id } = await dispatch(params.instance, {
    recipients: recipients.map((r) => ({ number: r.number, text: r.text })),
    delayMin: params.delayMinMs,
    delayMax: params.delayMaxMs,
    scheduledFor: params.scheduledFor,
    triggeredByUserId: params.userId,
    triggeredVia: "ui",
    trackSource: "quick-blast",
  });

  return { ok: true, sender_job_id, uazapi_sender_id, count: recipients.length, skipped };
}

/**
 * Merge carteira (upsell_clients) fields into leads by lead_id. Leads without a
 * portfolio row are returned unchanged. Failures are non-fatal — the blast
 * proceeds with lead-only variables.
 */
async function mergePortfolioData(
  supabaseAdmin: { from: (t: string) => any },
  orgId: string,
  leads: BlastLead[],
): Promise<BlastLead[]> {
  if (leads.length === 0) return leads;
  try {
    const leadIds = leads.map((l) => l.id);
    const { data: clients } = await supabaseAdmin
      .from("upsell_clients")
      .select("lead_id, segment, avg_ticket, days_since_last_order, lifetime_value")
      .eq("organization_id", orgId)
      .in("lead_id", leadIds);
    const byLead = new Map<string, any>();
    for (const c of (clients ?? []) as any[]) {
      if (c?.lead_id) byLead.set(c.lead_id, c);
    }
    if (byLead.size === 0) return leads;
    return leads.map((l) => {
      const c = byLead.get(l.id);
      return c
        ? {
            ...l,
            segment: c.segment,
            avg_ticket: c.avg_ticket,
            days_since_last_order: c.days_since_last_order,
            lifetime_value: c.lifetime_value,
          }
        : l;
    });
  } catch {
    return leads;
  }
}
