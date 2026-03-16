import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "./useAutoFollowUp";
import { triggerStageChangedWorkflows } from "@/lib/workflowTrigger";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";
import { useCanPerformActionAsync } from "@/lib/permissions";

export type PipeProposta = Tables<"pipe_propostas">;
export type PipePropostaInsert = TablesInsert<"pipe_propostas">;
export type PipePropostaUpdate = TablesUpdate<"pipe_propostas">;

// Dynamic — accepts any stage_key from pipeline_stages (custom stages supported)
export type PipePropostasStatus = string;

export const statusColumns: { id: string; title: string; color: string }[] = [
  { id: "marcar_compromisso", title: "Marcar Compromisso", color: "#F5C518" },
  { id: "reativar", title: "Reativar", color: "#F97316" },
  { id: "compromisso_marcado", title: "Compromisso Marcado", color: "#3B82F6" },
  { id: "esfriou", title: "Esfriou", color: "#64748B" },
  { id: "futuro", title: "Futuro", color: "#8B5CF6" },
  { id: "vendido", title: "Vendido ✓", color: "#22C55E" },
  { id: "perdido", title: "Perdido", color: "#EF4444" },
];

export function usePipePropostas() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("pipe_propostas", ["pipe_propostas", "follow_ups", "recent_activity", "tv-dashboard"]);

  return useQuery({
    queryKey: ["pipe_propostas", organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from("pipe_propostas")
        .select(`
          *,
          lead:leads(
            id, name, company, email, phone, rating, origin, segment, faturamento, ai_disabled, sdr_id, closer_id, responsible_id,
            responsible:team_members!leads_responsible_id_fkey(id, name),
            sdr:team_members!leads_sdr_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          responsible:team_members!pipe_propostas_responsible_id_fkey(id, name),
          closer:team_members!pipe_propostas_closer_id_fkey(id, name),
          product:products(id, name, type, ticket, ticket_minimo),
          items:pipe_proposta_items(
            id, product_id, sale_value, created_at,
            product:products(id, name, type, ticket, ticket_minimo)
          )
        `)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCreatePipeProposta() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (item: PipePropostaInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create pipe_propostas: No organization context");
      }
      const securedItem = {
        ...item,
        organization_id: organizationId,
      };
      const { data, error } = await supabase
        .from("pipe_propostas")
        .insert(securedItem)
        .select()
        .single();

      if (error) throw error;

      // Trigger automation for the initial status
      await triggerFollowUpAutomation({
        leadId: data.lead_id,
        assignedTo: data.responsible_id || data.closer_id,
        pipeType: "propostas",
        stage: data.status,
        sourcePipeId: data.id,
        organizationId: data.organization_id,
      });

      // Trigger visual workflow automations
      triggerStageChangedWorkflows({
        organizationId: data.organization_id,
        leadId: data.lead_id,
        pipeType: "propostas",
        toStage: data.status,
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["recent_activity"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useUpdatePipeProposta() {
  const queryClient = useQueryClient();
  const { data: movePermission } = useCanPerformActionAsync("move_pipe_record");

  return useMutation({
    mutationFn: async ({ id, leadId, closerId, skip_auto_push, ...updates }: PipePropostaUpdate & { id: string; leadId?: string; closerId?: string | null; skip_auto_push?: boolean }) => {
      if (updates.status && movePermission && !movePermission.allowed) {
        throw new Error("Sem permissão para mover registros no pipe");
      }
      const { data, error } = await supabase
        .from("pipe_propostas")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Sync responsible_id back to leads table
      const effectiveLeadId = leadId || data.lead_id;
      if (effectiveLeadId && updates.responsible_id !== undefined) {
        await supabase.from("leads").update({ responsible_id: updates.responsible_id || null }).eq("id", effectiveLeadId);
      }

      // Auto-push order to TinyERP when status changes to "vendido" (skip if modal already handled it)
      if (updates.status === "vendido" && data.organization_id && !skip_auto_push) {
        try {
          const { data: tinyConn } = await supabase
            .from("tinyerp_connections")
            .select("auto_push_orders, status")
            .eq("organization_id", data.organization_id)
            .eq("status", "connected")
            .maybeSingle();

          if (tinyConn?.auto_push_orders) {
            // Push order and refresh TinyERP queries so UI updates
            supabase.functions.invoke("tinyerp-push-order", {
              body: { pipe_proposta_id: id },
            }).then(({ data: pushResult, error: pushError }) => {
              if (pushError || pushResult?.error) {
                console.error("[TinyERP Auto-push] Error:", pushError || pushResult?.error);
              } else {
                // Invalidate TinyERP queries so TinyErpOrderStatus component updates
                queryClient.invalidateQueries({ queryKey: ["tinyerp-order-mapping"] });
                queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });
              }
            }).catch((err) => console.error("[TinyERP Auto-push] Error:", err));
          }
        } catch {
          // Ignore — TinyERP auto-push is best-effort
        }
      }

      // Trigger automation if status changed
      if (updates.status && effectiveLeadId) {
        await triggerFollowUpAutomation({
          leadId: effectiveLeadId,
          assignedTo: closerId || data.closer_id,
          pipeType: "propostas",
          stage: updates.status,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });

        // Trigger visual workflow automations
        triggerStageChangedWorkflows({
          organizationId: data.organization_id,
          leadId: effectiveLeadId,
          pipeType: "propostas",
          toStage: updates.status,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["recent_activity"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useDeletePipeProposta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Use .select("id") so PostgREST returns the affected rows.
      // Without it, Supabase returns { error: null } even when RLS silently
      // blocks the DELETE — causing the optimistic removal to appear to succeed
      // while the record remains in the database and reappears on the next refetch.
      const { data: deleted, error } = await supabase
        .from("pipe_propostas")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) throw error;

      if (!deleted || deleted.length === 0) {
        throw new Error(
          "Não foi possível excluir: permissão insuficiente ou registro não encontrado."
        );
      }
    },
    onMutate: async (id: string) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic update
      await queryClient.cancelQueries({ queryKey: ["pipe_propostas"] });

      // Snapshot previous cache for rollback
      const previousData = queryClient.getQueriesData({ queryKey: ["pipe_propostas"] });

      // Optimistically remove the proposal from all cached pipe_propostas queries
      queryClient.setQueriesData({ queryKey: ["pipe_propostas"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((item: any) => item.id !== id);
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      // Rollback optimistic update on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
    },
  });
}
