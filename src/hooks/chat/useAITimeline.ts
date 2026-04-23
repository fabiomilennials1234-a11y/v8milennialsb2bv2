/**
 * useAITimeline — eventos de IA do lead_history filtrados por action LIKE 'ai_%'.
 *
 * C31: consome lead_history com filtro de ações de IA.
 *
 * Segurança: RLS lead_history_select_by_lead cobre SELECT (B6 pré-atendido).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AiEventType =
  | "message_sent"
  | "action_executed"
  | "stage_moved"
  | "tag_added"
  | "silence_detected"
  | "handoff_triggered"
  | "reverted";

export interface AiTimelineEvent {
  id: string;
  type: AiEventType;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  is_reversible: boolean;
  reverted: boolean;
}

// ─── Mapa de ação DB → tipo de evento UI ──────────────────────────────────────

const ACTION_TO_TYPE: Record<string, AiEventType> = {
  ai_message_sent:       "message_sent",
  ai_action_executed:    "action_executed",
  ai_stage_moved:        "stage_moved",
  ai_tag_added:          "tag_added",
  ai_silence_detected:   "silence_detected",
  ai_handoff_triggered:  "handoff_triggered",
  ai_reverted:           "reverted",
};

const REVERSIBLE_ACTIONS = new Set<AiEventType>(["action_executed", "stage_moved", "tag_added"]);

function toEventType(action: string): AiEventType {
  return ACTION_TO_TYPE[action] ?? "action_executed";
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAITimeline(leadId: string | null | undefined) {
  const qc = useQueryClient();
  const queryKey = ["ai-timeline", leadId];

  const query = useQuery<AiTimelineEvent[]>({
    queryKey,
    queryFn: async () => {
      if (!leadId) return [];

      const { data, error } = await supabase
        .from("lead_history")
        .select("id, action, description, metadata, created_at")
        .eq("lead_id", leadId)
        .like("action", "ai_%")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      return (data ?? []).map((row) => {
        const type = toEventType(row.action);
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          type,
          description: row.description ?? null,
          metadata: meta,
          created_at: row.created_at,
          is_reversible: REVERSIBLE_ACTIONS.has(type) && !meta.reverted,
          reverted: !!meta.reverted,
        };
      });
    },
    enabled: !!leadId,
    staleTime: 60_000,
  });

  // Revert action — insere ai_reverted no lead_history
  const revertMutation = useMutation({
    mutationFn: async (event: AiTimelineEvent) => {
      if (!leadId) throw new Error("leadId ausente");

      const { error } = await supabase.from("lead_history").insert({
        lead_id: leadId,
        action: "ai_reverted",
        description: `Ação revertida: ${event.type} (${event.id})`,
        metadata: { original_event_id: event.id, original_type: event.type },
        source: "manual",
      });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Ação revertida");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao reverter ação");
    },
  });

  return {
    ...query,
    revert: (event: AiTimelineEvent) => revertMutation.mutateAsync(event),
    isReverting: revertMutation.isPending,
  };
}
