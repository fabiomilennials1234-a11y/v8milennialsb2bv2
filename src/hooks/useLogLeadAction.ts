import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export type LeadActionType =
  | "lead_created"
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
  | "copilot_interaction";

interface LogLeadActionParams {
  leadId: string;
  action: LeadActionType;
  description: string;
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

  const logAction = async ({ leadId, action, description }: LogLeadActionParams) => {
    try {
      const [userName, userId] = await Promise.all([
        resolveUserName(),
        resolveUserId(),
      ]);

      const fullDescription = userName !== "Sistema"
        ? `${userName}: ${description}`
        : `Sistema: ${description}`;

      await supabase.from("lead_history").insert({
        lead_id: leadId,
        action,
        description: fullDescription,
        created_by: userId,
        organization_id: organizationId,
      });

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
