import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { useOrganization } from "@/modules/identity";
export type LeadActionType =
  | "lead_created"
  | "lead_deleted"
  | "stage_changed"
  | "sdr_assigned"
  | "closer_assigned"
  | "field_updated"
  | "note_added"
  | "meeting_scheduled"
  | "meeting_attended"
  | "meeting_missed"
  | "meeting_deleted"
  | "proposal_created"
  | "proposal_status_changed"
  | "proposal_deleted"
  | "product_linked"
  | "followup_created"
  | "followup_completed"
  | "ai_toggled"
  | "copilot_interaction"
  | "pipe_added"
  | "pipe_removed"
  | "comment_added"
  | "comment_updated"
  | "comment_deleted"
  | "tag_added"
  | "tag_removed";

/**
 * Audit tier (#310).
 *   1 — irreversible / compliance (delete lead, permission change). Goes to lead_history.
 *   2 — default. Mutations that belong on the user-visible timeline. Goes to lead_history.
 *   3 — telemetry / noise (UI events, redundant signals). Goes to analytics.track() only.
 */
export type LeadActionTier = 1 | 2 | 3;

interface LogLeadActionParams {
  leadId: string;
  action: LeadActionType;
  description: string;
  metadata?: Record<string, unknown>;
  tier?: LeadActionTier;
}

let cachedUserName: string | null = null;
let cachedUserId: string | null = null;

async function resolveUserName(): Promise<string> {
  if (cachedUserName) return cachedUserName;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "Sistema";

  cachedUserId = user.id;

  const { data: member } = await supabase
    .from("team_members")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle();

  cachedUserName = member?.name || user.email?.split("@")[0] || "Usuário";
  return cachedUserName;
}

async function resolveUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const { data: { user } } = await supabase.auth.getUser();
  cachedUserId = user?.id ?? null;
  return cachedUserId;
}

/**
 * Hook that returns a function to log lead actions.
 * Fire-and-forget: never blocks the main action.
 */
export function useLogLeadAction() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const logAction = async ({ leadId, action, description, metadata, tier = 2 }: LogLeadActionParams) => {
    // Tier 3 → analytics only, never touches lead_history.
    if (tier === 3) {
      try {
        track({
          event: "lead_action_telemetry",
          organizationId: organizationId ?? "",
          entityType: "lead",
          entityId: leadId,
          metadata: { action, description, ...(metadata ?? {}) },
        });
      } catch (error) {
        console.warn("[useLogLeadAction] Tier 3 track falhou:", error);
      }
      return;
    }

    try {
      const [userName, userId] = await Promise.all([
        resolveUserName(),
        resolveUserId(),
      ]);

      const fullDescription = userName !== "Sistema"
        ? `${userName}: ${description}`
        : `Sistema: ${description}`;

      const insertRow: Record<string, unknown> = {
        lead_id: leadId,
        action,
        description: fullDescription,
        created_by: userId,
        organization_id: organizationId,
      };
      if (metadata && Object.keys(metadata).length > 0) {
        insertRow.metadata = metadata;
      }

      await supabase.from("lead_history").insert(insertRow as never);

      queryClient.invalidateQueries({ queryKey: ["lead_history", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-history", leadId] });
    } catch (error) {
      console.warn("[useLogLeadAction] Falha ao registrar histórico:", error);
    }
  };

  return logAction;
}

/**
 * Standalone function for server-side or non-hook contexts.
 * Used by edge functions that insert directly.
 */
export async function logLeadActionDirect(params: {
  leadId: string;
  action: LeadActionType;
  description: string;
  organizationId?: string;
}) {
  try {
    await supabase.from("lead_history").insert({
      lead_id: params.leadId,
      action: params.action,
      description: `Sistema: ${params.description}`,
      created_by: null,
      organization_id: params.organizationId || null,
    });
  } catch (error) {
    console.warn("[logLeadActionDirect] Falha ao registrar histórico:", error);
  }
}
