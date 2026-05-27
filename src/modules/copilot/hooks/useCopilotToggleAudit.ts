/**
 * useCopilotToggleAudit — leitura do histórico de toggles + drift detection.
 *
 * Onda 3 F6 (2026-04-26).
 *
 * Fontes:
 *   - lead_history.action IN ('ai_disabled','ai_reactivated','ai_toggled') —
 *     todo toggle passa por aqui (RPCs setam audit).
 *   - master_audit_logs.action IN ('copilot_disabled','copilot_enabled') —
 *     toggles via master_set_copilot_disabled.
 *   - drift query: leads onde leads.ai_disabled != phone_ai_preferences.ai_disabled
 *     pra mesma org+normalized_phone (sync falhou).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CopilotToggleAuditEntry {
  id: string;
  source: "lead_history" | "master_audit_log";
  lead_id: string | null;
  organization_id: string | null;
  action: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  set_by_user_id: string | null;
  set_by_master: boolean;
  rpc: string | null;
  created_at: string;
}

export interface CopilotDriftRow {
  organization_id: string;
  normalized_phone: string;
  preferences_disabled: boolean;
  leads_disabled_count: number;
  leads_enabled_count: number;
  total_leads: number;
}

export interface CopilotToggleAuditFilters {
  organizationId?: string;
  leadId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export function useCopilotToggleAudit(filters: CopilotToggleAuditFilters = {}) {
  return useQuery({
    queryKey: ["copilot-toggle-audit", filters],
    queryFn: async (): Promise<CopilotToggleAuditEntry[]> => {
      // 1. lead_history (RPCs canônicas escrevem aqui)
      let lhQuery = supabase
        .from("lead_history")
        .select("id, lead_id, action, description, metadata, created_at, leads!inner(organization_id)")
        .in("action", ["ai_disabled", "ai_reactivated", "ai_toggled"])
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 100);

      if (filters.leadId) lhQuery = lhQuery.eq("lead_id", filters.leadId);
      if (filters.startDate) lhQuery = lhQuery.gte("created_at", filters.startDate);
      if (filters.endDate) lhQuery = lhQuery.lte("created_at", filters.endDate);

      const { data: leadHist, error: lhErr } = await lhQuery;
      if (lhErr) throw lhErr;

      // 2. master_audit_logs (master toggles)
      let malQuery = supabase
        .from("master_audit_logs")
        .select("id, master_user_id, user_id, action, target_id, target_name, details, created_at")
        .in("action", ["copilot_disabled", "copilot_enabled"])
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 100);

      if (filters.startDate) malQuery = malQuery.gte("created_at", filters.startDate);
      if (filters.endDate) malQuery = malQuery.lte("created_at", filters.endDate);

      const { data: masterLogs, error: malErr } = await malQuery;
      if (malErr) console.warn("[useCopilotToggleAudit] master_audit_logs error:", malErr.message);

      const lhEntries: CopilotToggleAuditEntry[] = (leadHist ?? []).map((row: any) => ({
        id: `lh_${row.id}`,
        source: "lead_history" as const,
        lead_id: row.lead_id,
        organization_id: row.leads?.organization_id ?? null,
        action: row.action,
        description: row.description,
        metadata: row.metadata as Record<string, unknown> | null,
        set_by_user_id:
          (row.metadata as any)?.disabled_by ??
          (row.metadata as any)?.reactivated_by ??
          null,
        set_by_master: ((row.metadata as any)?.source_rpc === "master_set_copilot_disabled"),
        rpc: (row.metadata as any)?.source_rpc ?? null,
        created_at: row.created_at,
      }));

      const malEntries: CopilotToggleAuditEntry[] = (masterLogs ?? []).map((row: any) => ({
        id: `mal_${row.id}`,
        source: "master_audit_log" as const,
        lead_id: row.target_type === "lead" ? row.target_id : null,
        organization_id: (row.details as any)?.organization_id ?? null,
        action: row.action,
        description: `Master Admin: ${row.action} (${row.target_name ?? "—"})`,
        metadata: row.details as Record<string, unknown> | null,
        set_by_user_id: row.user_id,
        set_by_master: true,
        rpc: "master_set_copilot_disabled",
        created_at: row.created_at,
      }));

      const merged = [...lhEntries, ...malEntries].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      const orgFiltered = filters.organizationId
        ? merged.filter((e) => e.organization_id === filters.organizationId)
        : merged;

      return orgFiltered.slice(0, filters.limit ?? 100);
    },
    staleTime: 60_000,
  });
}

/**
 * Drift detection: leads onde leads.ai_disabled diverge de
 * phone_ai_preferences.ai_disabled pra mesma org+phone.
 */
export function useCopilotToggleDrift() {
  return useQuery({
    queryKey: ["copilot-toggle-drift"],
    queryFn: async (): Promise<CopilotDriftRow[]> => {
      // Usa SQL raw via RPC quando possível; aqui fazemos client-side join leve.
      const { data: prefs, error: prefErr } = await supabase
        .from("phone_ai_preferences")
        .select("organization_id, normalized_phone, ai_disabled");
      if (prefErr) throw prefErr;

      const { data: leadsRaw, error: leadsErr } = await supabase
        .from("leads")
        .select("organization_id, normalized_phone, ai_disabled")
        .not("normalized_phone", "is", null);
      if (leadsErr) throw leadsErr;

      const leadsMap = new Map<string, { d: number; e: number; total: number }>();
      for (const l of leadsRaw ?? []) {
        const key = `${l.organization_id}|${l.normalized_phone}`;
        const cur = leadsMap.get(key) ?? { d: 0, e: 0, total: 0 };
        cur.total++;
        if (l.ai_disabled) cur.d++;
        else cur.e++;
        leadsMap.set(key, cur);
      }

      const drift: CopilotDriftRow[] = [];
      for (const p of prefs ?? []) {
        const key = `${p.organization_id}|${p.normalized_phone}`;
        const stats = leadsMap.get(key);
        if (!stats) continue; // preference sem lead — não conta drift
        const expectedDisabled = p.ai_disabled;
        // Drift: nem todos os leads têm ai_disabled = preference
        if (
          (expectedDisabled && stats.e > 0) ||
          (!expectedDisabled && stats.d > 0)
        ) {
          drift.push({
            organization_id: p.organization_id,
            normalized_phone: p.normalized_phone,
            preferences_disabled: expectedDisabled,
            leads_disabled_count: stats.d,
            leads_enabled_count: stats.e,
            total_leads: stats.total,
          });
        }
      }

      return drift.sort((a, b) => b.total_leads - a.total_leads);
    },
    staleTime: 5 * 60_000,
  });
}
