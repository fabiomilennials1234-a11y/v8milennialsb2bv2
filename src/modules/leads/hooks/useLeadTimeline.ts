import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback } from "react";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

// ─── Types ────────────────────────────────────────────────

export type TimelineSource = "manual" | "agent" | "automation" | "system";

export type TimelinePeriod = "today" | "week" | "month" | "all";

// Legacy lead_history row shape (full table columns) — kept for callers
// migrados de `useLeadHistory` que iteram diretamente sobre o row.
export type LeadHistory = Tables<"lead_history">;
export type LeadHistoryInsert = TablesInsert<"lead_history">;

// Field-level changelog item — vem da RPC `get_lead_field_changes`.
export interface FieldChange {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  user_name: string;
}

export interface TimelineFilters {
  source: TimelineSource | "all" | "pipeline";
  period: TimelinePeriod;
  search: string;
}

export interface TimelineEvent {
  id: string;
  action: string;
  description: string | null;
  source: TimelineSource;
  metadata: Record<string, unknown> | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  created_by: string | null;
}

export interface TimelineMetrics {
  total: number;
  daysSinceFirstContact: number;
  lastContact: string | null;
  topSource: TimelineSource | null;
}

export interface TimelinePage {
  events: TimelineEvent[];
  metrics: TimelineMetrics;
  hasMore: boolean;
  totalFiltered: number;
}

// ─── Filter helpers ───────────────────────────────────────

function getPeriodStart(period: TimelinePeriod): string | null {
  if (period === "all") return null;
  const now = new Date();
  if (period === "today") {
    now.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    now.setDate(now.getDate() - 7);
    now.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    now.setMonth(now.getMonth() - 1);
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

const PIPELINE_ACTIONS = [
  "stage_changed",
  "proposal_created",
  "proposal_status_changed",
  "proposal_deleted",
];

// ─── Hook ─────────────────────────────────────────────────

const PAGE_SIZE = 20;

export function useLeadTimeline(leadId: string | undefined) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TimelineFilters>({
    source: "all",
    period: "all",
    search: "",
  });
  const [page, setPage] = useState(1);

  // Reset page when filters change
  const updateFilters = useCallback((partial: Partial<TimelineFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
    setPage(1);
  }, []);

  const query = useQuery({
    queryKey: ["lead-timeline", leadId, filters, page],
    queryFn: async (): Promise<TimelinePage> => {
      if (!leadId) return { events: [], metrics: { total: 0, daysSinceFirstContact: 0, lastContact: null, topSource: null }, hasMore: false, totalFiltered: 0 };

      // Build query
      let q = supabase
        .from("lead_history")
        .select("id, action, description, source, metadata, entity_type, entity_id, created_at, created_by", { count: "exact" })
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });

      // Source filter
      if (filters.source !== "all") {
        if (filters.source === "pipeline") {
          q = q.in("action", PIPELINE_ACTIONS);
        } else {
          q = q.eq("source", filters.source);
        }
      }

      // Period filter
      const periodStart = getPeriodStart(filters.period);
      if (periodStart) {
        q = q.gte("created_at", periodStart);
      }

      // Search filter
      if (filters.search.trim()) {
        q = q.ilike("description", `%${filters.search.trim()}%`);
      }

      // Pagination
      const from = 0;
      const to = page * PAGE_SIZE - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;

      const events = (data || []) as unknown as TimelineEvent[];
      const totalFiltered = count ?? 0;

      // Metrics: fetch from all history (unfiltered) — only on first page
      let metrics: TimelineMetrics = { total: 0, daysSinceFirstContact: 0, lastContact: null, topSource: null };

      if (page === 1) {
        const { data: allHistory, count: totalCount } = await supabase
          .from("lead_history")
          .select("source, created_at", { count: "exact" })
          .eq("lead_id", leadId)
          .order("created_at", { ascending: true });

        const total = totalCount ?? 0;
        const first = allHistory?.[0]?.created_at;
        const last = allHistory?.[allHistory.length - 1]?.created_at;

        // Count sources
        const sourceCounts: Record<string, number> = {};
        for (const item of allHistory || []) {
          const src = (item as Record<string, unknown>).source as string || "manual";
          sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        }

        let topSource: TimelineSource | null = null;
        let topCount = 0;
        for (const [src, cnt] of Object.entries(sourceCounts)) {
          if (cnt > topCount) {
            topSource = src as TimelineSource;
            topCount = cnt;
          }
        }

        const daysSinceFirstContact = first
          ? Math.floor((Date.now() - new Date(first).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        metrics = {
          total,
          daysSinceFirstContact,
          lastContact: last || null,
          topSource,
        };
      }

      return {
        events,
        metrics,
        hasMore: totalFiltered > page * PAGE_SIZE,
        totalFiltered,
      };
    },
    enabled: !!leadId,
    staleTime: 30000,
  });

  const loadMore = useCallback(() => {
    setPage((prev) => prev + 1);
  }, []);

  const invalidate = useCallback(() => {
    if (leadId) {
      queryClient.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-history", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-history-compact", leadId] });
    }
  }, [leadId, queryClient]);

  return {
    ...query,
    filters,
    updateFilters,
    loadMore,
    invalidate,
    page,
  };
}

// ─── Compact hook for sidebar ─────────────────────────────

export function useLeadTimelineCompact(leadId: string | undefined) {
  return useQuery({
    queryKey: ["lead-history-compact", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_history")
        .select("id, action, description, source, metadata, entity_type, created_at")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data || []) as unknown as TimelineEvent[];
    },
    enabled: !!leadId,
    staleTime: 30000,
    refetchInterval: 30000,
  });
}

// ─── Legacy lead_history reader/writer ────────────────────
// Consolidado de `useLeadHistory.ts` (slice 4) — mantém signature
// compatível com call sites legados (ConfirmacaoDetailModal,
// ProposalDetailModal, ClientDetailModal, LeadModal) que iteram
// sobre o row completo de `lead_history`.

export function useLeadHistory(leadId: string | undefined | null) {
  return useQuery({
    queryKey: ["lead_history", leadId],
    queryFn: async () => {
      if (!leadId) return [];

      const { data, error } = await supabase
        .from("lead_history")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!leadId,
  });
}

export function useCreateLeadHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (history: LeadHistoryInsert) => {
      const { data, error } = await supabase
        .from("lead_history")
        .insert(history)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead_history", data.lead_id] });
    },
  });
}

// ─── Field changelog (RPC) ────────────────────────────────
// Consolidado de `useFieldChangelog.ts` (slice 4). `FIELD_LABELS` +
// helpers de format foram extraídos para `@/shared/format/lead-field-labels`
// (utilitário cross-module sem dependência de React/Supabase). Re-exportados
// aqui para conveniência dos call sites que importavam tudo de um único path.

export {
  FIELD_LABELS,
  getFieldLabel,
  formatFieldValue,
} from "@/shared/format/lead-field-labels";

/**
 * Fetches field-level changes for a lead via the RPC `get_lead_field_changes`.
 */
export function useFieldChangelog(leadId: string | null | undefined, limit = 50) {
  return useQuery({
    queryKey: ["field_changelog", leadId, limit],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_lead_field_changes", {
        p_lead_id: leadId,
        p_limit: limit,
      });

      if (error) throw error;
      return (data || []) as FieldChange[];
    },
  });
}
