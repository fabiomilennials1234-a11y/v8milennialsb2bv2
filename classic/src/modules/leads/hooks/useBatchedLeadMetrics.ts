/**
 * useBatchedLeadMetrics
 *
 * Busca contadores agregados pra N leads em 2 queries (comments + checklists).
 * Usado pelo LeadCard pra evitar N+1.
 *
 * Retorno: Map<leadId, { commentsCount, checklistsTotal, checklistsCompleted }>.
 *
 * Freshness: realtime em `checklists`/`checklist_items` (estão na publication).
 * `lead_comments` NÃO está na publication — a contagem de comentários é
 * invalidada pelas mutations do modal (useLeadComments) via ["lead-card-metrics"].
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";

export interface LeadMetrics {
  commentsCount: number;
  checklistsTotal: number;
  checklistsCompleted: number;
}

const EMPTY: LeadMetrics = {
  commentsCount: 0,
  checklistsTotal: 0,
  checklistsCompleted: 0,
};

export function useBatchedLeadMetrics(leadIds: string[]) {
  const sortedIds = [...new Set(leadIds)].sort();
  // Card reflete checklists em tempo real (edição no modal, trigger de stage,
  // workflow apply_checklist). Comentários cobertos por invalidação cross-cache.
  useRealtimeSubscription("checklists", ["lead-card-metrics"]);
  useRealtimeSubscription("checklist_items", ["lead-card-metrics"]);
  return useQuery({
    queryKey: ["lead-card-metrics", sortedIds],
    queryFn: async (): Promise<Record<string, LeadMetrics>> => {
      if (sortedIds.length === 0) return {};
      const acc: Record<string, LeadMetrics> = {};
      for (const id of sortedIds) acc[id] = { ...EMPTY };

      const sb = supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            in: (col: string, vals: string[]) => {
              is?: (col: string, v: null) => Promise<{ data: unknown[] | null }>;
            } & Promise<{ data: unknown[] | null }>;
          };
        };
      };

      // Comments — count active by lead
      const commentsRes = await sb
        .from("lead_comments")
        .select("lead_id")
        .in("lead_id", sortedIds)
        .is!("deleted_at", null);

      for (const row of ((commentsRes.data ?? []) as Array<{ lead_id: string }>)) {
        if (acc[row.lead_id]) acc[row.lead_id].commentsCount += 1;
      }

      // Checklists — join checklist_items to aggregate completion
      const checklistsRes = await sb
        .from("checklists")
        .select("lead_id, checklist_items(is_completed)")
        .in("lead_id", sortedIds);

      for (const row of ((checklistsRes.data ?? []) as Array<{
        lead_id: string;
        checklist_items: Array<{ is_completed: boolean }>;
      }>)) {
        const metrics = acc[row.lead_id];
        if (!metrics) continue;
        for (const item of row.checklist_items ?? []) {
          metrics.checklistsTotal += 1;
          if (item.is_completed) metrics.checklistsCompleted += 1;
        }
      }

      return acc;
    },
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
  });
}
