import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";

export type Lead = Tables<"leads">;
export type LeadInsert = TablesInsert<"leads">;
export type LeadUpdate = TablesUpdate<"leads">;

/**
 * Fetch leads filtered by current user's organization
 * SECURITY: Always filters by organization_id to ensure data isolation
 */
export function useLeads() {
  const { organizationId, isReady } = useOrganization();
  
  useRealtimeSubscription("leads", ["leads", "pipe_whatsapp", "pipe_confirmacao", "pipe_propostas"]);
  
  return useQuery({
    queryKey: ["leads", organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.warn("[useLeads] No organization_id available - returning empty array");
        return [];
      }
      
      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `)
        // SECURITY: Filter by organization_id
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    // Only run query when organization is ready
    enabled: isReady,
  });
}

/**
 * Create a new lead
 * SECURITY: Automatically sets organization_id from current user's context
 * Never trust organization_id from client input
 */
export function useCreateLead() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  
  return useMutation({
    mutationFn: async (lead: LeadInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create lead: No organization context");
      }
      
      // SECURITY: Always override organization_id with current user's org
      // Never trust the organization_id from the input
      const securedLead = {
        ...lead,
        organization_id: organizationId, // Force organization_id
      };
      
      const { data, error } = await supabase
        .from("leads")
        .insert(securedLead)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/**
 * Update an existing lead
 * SECURITY: Filters by organization_id to prevent cross-tenant updates
 */
export function useUpdateLead() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: LeadUpdate & { id: string }) => {
      if (!organizationId) {
        throw new Error("Cannot update lead: No organization context");
      }
      
      // SECURITY: Remove organization_id from updates to prevent tampering
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { organization_id: _, ...safeUpdates } = updates as LeadUpdate & { organization_id?: string };
      
      const { data, error } = await supabase
        .from("leads")
        .update(safeUpdates)
        .eq("id", id)
        // SECURITY: Ensure lead belongs to user's organization
        .eq("organization_id", organizationId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
    },
  });
}

/**
 * Delete a lead and all related records
 * SECURITY: Verifies lead belongs to user's organization before deletion
 */
export function useDeleteLead() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  
  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) {
        throw new Error("Cannot delete lead: No organization context");
      }
      
      // SECURITY: First verify the lead belongs to current organization
      const { data: lead, error: verifyError } = await supabase
        .from("leads")
        .select("id")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .single();
      
      if (verifyError || !lead) {
        throw new Error("Lead not found or access denied");
      }
      
      // Delete related records (RLS will also protect these)
      await supabase.from("lead_tags").delete().eq("lead_id", id);
      await supabase.from("lead_history").delete().eq("lead_id", id);
      await supabase.from("follow_ups").delete().eq("lead_id", id);
      await supabase.from("pipe_whatsapp").delete().eq("lead_id", id);
      await supabase.from("pipe_confirmacao").delete().eq("lead_id", id);
      await supabase.from("pipe_propostas").delete().eq("lead_id", id);
      
      // Then delete the lead
      const { error } = await supabase
        .from("leads")
        .delete()
        .eq("id", id)
        // SECURITY: Double-check organization ownership
        .eq("organization_id", organizationId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

/**
 * Toggle AI disabled status for a lead
 * When disabled, the Copilot agent will not respond to messages from this lead
 */
export function useToggleLeadAI() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  
  return useMutation({
    mutationFn: async ({ leadId, disabled }: { leadId: string; disabled: boolean }) => {
      if (!organizationId) {
        throw new Error("Cannot update lead: No organization context");
      }
      
      // Get current user ID
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from("leads")
        .update({
          ai_disabled: disabled,
          ai_disabled_at: disabled ? new Date().toISOString() : null,
          ai_disabled_by: disabled ? user?.id : null,
        })
        .eq("id", leadId)
        // SECURITY: Ensure lead belongs to user's organization
        .eq("organization_id", organizationId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    // Atualização otimista para feedback imediato
    onMutate: async ({ leadId, disabled }) => {
      // Cancelar queries em andamento para evitar sobrescrever a atualização otimista
      await queryClient.cancelQueries({ queryKey: ["lead-detail", leadId] });
      await queryClient.cancelQueries({ queryKey: ["leads"] });
      await queryClient.cancelQueries({ queryKey: ["pipe_whatsapp"] });
      await queryClient.cancelQueries({ queryKey: ["pipe_confirmacao"] });
      await queryClient.cancelQueries({ queryKey: ["pipe_propostas"] });
      await queryClient.cancelQueries({ queryKey: ["lead_by_phone"] });
      
      // Snapshot do estado anterior
      const previousLeadDetail = queryClient.getQueryData(["lead-detail", leadId]);
      const previousLeads = queryClient.getQueryData(["leads", organizationId]);
      const previousPipeWhatsapp = queryClient.getQueryData(["pipe_whatsapp"]);
      const previousPipeConfirmacao = queryClient.getQueryData(["pipe_confirmacao"]);
      const previousPipePropostas = queryClient.getQueryData(["pipe_propostas"]);
      
      // Snapshot de todas as queries lead_by_phone que podem conter esse lead
      const previousLeadByPhone: Record<string, any> = {};
      const queryCache = queryClient.getQueryCache();
      queryCache.findAll({ queryKey: ["lead_by_phone"] }).forEach((query) => {
        const data = queryClient.getQueryData(query.queryKey);
        if (data && typeof data === 'object' && 'id' in data && data.id === leadId) {
          previousLeadByPhone[JSON.stringify(query.queryKey)] = data;
        }
      });
      
      // Atualização otimista do lead-detail
      queryClient.setQueryData(["lead-detail", leadId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ai_disabled: disabled,
          ai_disabled_at: disabled ? new Date().toISOString() : null,
        };
      });
      
      // Atualização otimista da lista de leads
      queryClient.setQueryData(["leads", organizationId], (old: any) => {
        if (!old) return old;
        return old.map((lead: Lead) =>
          lead.id === leadId
            ? { ...lead, ai_disabled: disabled, ai_disabled_at: disabled ? new Date().toISOString() : null }
            : lead
        );
      });
      
      // Atualização otimista dos pipes
      const updatePipeData = (old: any) => {
        if (!old) return old;
        return old.map((item: any) =>
          item.leadId === leadId || item.lead_id === leadId
            ? { ...item, ai_disabled: disabled }
            : item
        );
      };
      
      queryClient.setQueryData(["pipe_whatsapp"], updatePipeData);
      queryClient.setQueryData(["pipe_confirmacao"], updatePipeData);
      queryClient.setQueryData(["pipe_propostas"], updatePipeData);
      
      // Atualização otimista de todas as queries lead_by_phone que contêm esse lead
      queryCache.findAll({ queryKey: ["lead_by_phone"] }).forEach((query) => {
        queryClient.setQueryData(query.queryKey, (old: any) => {
          if (!old) return old;
          // Se é o lead correto, atualizar
          if (old.id === leadId) {
            return {
              ...old,
              ai_disabled: disabled,
              ai_disabled_at: disabled ? new Date().toISOString() : null,
            };
          }
          return old;
        });
      });
      
      // Retornar contexto para rollback em caso de erro
      return {
        previousLeadDetail,
        previousLeads,
        previousPipeWhatsapp,
        previousPipeConfirmacao,
        previousPipePropostas,
        previousLeadByPhone,
      };
    },
    onError: (err, variables, context) => {
      // Rollback em caso de erro
      if (context?.previousLeadDetail) {
        queryClient.setQueryData(["lead-detail", variables.leadId], context.previousLeadDetail);
      }
      if (context?.previousLeads) {
        queryClient.setQueryData(["leads", organizationId], context.previousLeads);
      }
      if (context?.previousPipeWhatsapp) {
        queryClient.setQueryData(["pipe_whatsapp"], context.previousPipeWhatsapp);
      }
      if (context?.previousPipeConfirmacao) {
        queryClient.setQueryData(["pipe_confirmacao"], context.previousPipeConfirmacao);
      }
      if (context?.previousPipePropostas) {
        queryClient.setQueryData(["pipe_propostas"], context.previousPipePropostas);
      }
      // Rollback das queries lead_by_phone
      if (context?.previousLeadByPhone) {
        Object.entries(context.previousLeadByPhone).forEach(([key, value]) => {
          queryClient.setQueryData(JSON.parse(key), value);
        });
      }
    },
    onSuccess: (_, variables) => {
      // Invalidar todas as queries relacionadas para garantir sincronização
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["lead-detail", variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["lead_by_phone"] });
    },
  });
}
