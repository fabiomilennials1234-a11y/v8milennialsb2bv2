import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "./useAutoFollowUp";
import { triggerStageChangedWorkflows } from "@/lib/workflowTrigger";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";
import { useCanPerformActionAsync } from "@/lib/permissions";

export type PipeConfirmacao = Tables<"pipe_confirmacao">;
export type PipeConfirmacaoInsert = TablesInsert<"pipe_confirmacao">;
export type PipeConfirmacaoUpdate = TablesUpdate<"pipe_confirmacao">;

// Dynamic — accepts any stage_key from pipeline_stages (custom stages supported)
export type PipeConfirmacaoStatus = string;

// Visual Kanban columns - pre_confirmada and confirmada_no_dia are NOT shown as columns
// They are visual states (colors) on the cards instead
export const statusColumns: { id: string; title: string; color: string }[] = [
  { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
  { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
  { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
  { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
  { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
  { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
  { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
  { id: "compareceu", title: "Compareceu ✓", color: "#22c55e" },
  { id: "perdido", title: "Perdido ✗", color: "#ef4444" },
];

export function usePipeConfirmacao() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("pipe_confirmacao", ["pipe_confirmacao", "follow_ups", "tv-dashboard"]);

  return useQuery({
    queryKey: ["pipe_confirmacao", organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .select(`
          *,
          lead:leads(
            id, name, company, email, phone, rating, origin, segment, faturamento, urgency, ai_disabled, sdr_id, closer_id,
            sdr:team_members!leads_sdr_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          sdr:team_members!pipe_confirmacao_sdr_id_fkey(id, name),
          closer:team_members!pipe_confirmacao_closer_id_fkey(id, name)
        `)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCreatePipeConfirmacao() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (item: PipeConfirmacaoInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create pipe_confirmacao: No organization context");
      }
      const securedItem = {
        ...item,
        organization_id: organizationId,
      };
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .insert(securedItem)
        .select()
        .single();

      if (error) throw error;

      // Trigger automation for the initial status
      await triggerFollowUpAutomation({
        leadId: data.lead_id,
        assignedTo: data.sdr_id || data.closer_id,
        pipeType: "confirmacao",
        stage: data.status,
        sourcePipeId: data.id,
        organizationId: data.organization_id,
      });

      // Trigger visual workflow automations
      triggerStageChangedWorkflows({
        organizationId: data.organization_id,
        leadId: data.lead_id,
        pipeType: "confirmacao",
        toStage: data.status,
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useUpdatePipeConfirmacao() {
  const queryClient = useQueryClient();
  const { data: movePermission } = useCanPerformActionAsync("move_pipe_record");

  return useMutation({
    mutationFn: async ({ id, leadId, assignedTo, ...updates }: PipeConfirmacaoUpdate & { id: string; leadId?: string; assignedTo?: string | null }) => {
      if (updates.status && movePermission && !movePermission.allowed) {
        throw new Error("Sem permissão para mover registros no pipe");
      }
      const payload = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      ) as PipeConfirmacaoUpdate;
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Sync SDR/Closer back to leads table
      if (leadId && (updates.sdr_id !== undefined || updates.closer_id !== undefined)) {
        const leadUpdate: Record<string, string | null> = {};
        if (updates.sdr_id !== undefined) leadUpdate.sdr_id = updates.sdr_id || null;
        if (updates.closer_id !== undefined) leadUpdate.closer_id = updates.closer_id || null;
        await supabase.from("leads").update(leadUpdate).eq("id", leadId);
      }

      // Trigger automation if status changed
      if (updates.status && leadId) {
        await triggerFollowUpAutomation({
          leadId: leadId,
          assignedTo: assignedTo || data.sdr_id || data.closer_id,
          pipeType: "confirmacao",
          stage: updates.status,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });

        // Trigger visual workflow automations
        triggerStageChangedWorkflows({
          organizationId: data.organization_id,
          leadId,
          pipeType: "confirmacao",
          toStage: updates.status,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useDeletePipeConfirmacao() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pipe_confirmacao")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
