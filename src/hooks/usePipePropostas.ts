import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "./useAutoFollowUp";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";

export type PipeProposta = Tables<"pipe_propostas">;
export type PipePropostaInsert = TablesInsert<"pipe_propostas">;
export type PipePropostaUpdate = TablesUpdate<"pipe_propostas">;

export type PipePropostasStatus =
  | "marcar_compromisso"
  | "reativar"
  | "compromisso_marcado"
  | "esfriou"
  | "futuro"
  | "vendido"
  | "perdido";

export const statusColumns: { id: PipePropostasStatus; title: string; color: string }[] = [
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
  useRealtimeSubscription("pipe_propostas", ["pipe_propostas", "follow_ups", "recent_activity"]);

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
            id, name, company, email, phone, rating, origin, segment, faturamento, ai_disabled,
            sdr:team_members!leads_sdr_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          closer:team_members!pipe_propostas_closer_id_fkey(id, name),
          product:products(id, name, type, ticket, ticket_minimo),
          items:pipe_proposta_items(
            id, product_id, sale_value, created_at,
            product:products(id, name, type, ticket, ticket_minimo)
          )
        `)
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false });

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
        assignedTo: data.closer_id,
        pipeType: "propostas",
        stage: data.status,
        sourcePipeId: data.id,
        organizationId: data.organization_id,
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
  
  return useMutation({
    mutationFn: async ({ id, leadId, closerId, ...updates }: PipePropostaUpdate & { id: string; leadId?: string; closerId?: string | null }) => {
      const { data, error } = await supabase
        .from("pipe_propostas")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;

      // Trigger automation if status changed
      if (updates.status && leadId) {
        await triggerFollowUpAutomation({
          leadId: leadId,
          assignedTo: closerId || data.closer_id,
          pipeType: "propostas",
          stage: updates.status,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
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
      const { error } = await supabase
        .from("pipe_propostas")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
    },
  });
}
