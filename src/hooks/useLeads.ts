import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";
import { track } from "@/lib/analytics";
import { useCanPerformActionAsync } from "@/lib/permissions";

export type Lead = Tables<"leads">;
export type LeadInsert = TablesInsert<"leads">;
export type LeadUpdate = TablesUpdate<"leads">;

const LEADS_PAGE_SIZE = 50;

export interface LeadsFilterParams {
  page?: number;
  searchQuery?: string;
  filterOrigin?: string;
  filterRating?: string;
}

/**
 * Apply shared filters to a Supabase query builder.
 * Used by both useLeads and useLeadsCount to ensure consistency.
 */
function applyLeadsFilters(
  query: any,
  organizationId: string,
  filters: Omit<LeadsFilterParams, "page">
) {
  query = query
    .eq("organization_id", organizationId)
    .or("is_shadow.is.null,is_shadow.eq.false");

  const search = filters.searchQuery?.trim();
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`);
  }

  if (filters.filterOrigin && filters.filterOrigin !== "all") {
    query = query.eq("origin", filters.filterOrigin);
  }

  if (filters.filterRating && filters.filterRating !== "all") {
    if (filters.filterRating === "high") query = query.gte("rating", 7);
    else if (filters.filterRating === "medium") query = query.gte("rating", 4).lt("rating", 7);
    else if (filters.filterRating === "low") query = query.lt("rating", 4);
  }

  return query;
}

/**
 * Fetch leads filtered by current user's organization — COM PAGINAÇÃO E FILTROS SERVER-SIDE
 * SECURITY: Always filters by organization_id to ensure data isolation
 * Retorna até LEADS_PAGE_SIZE leads por página.
 */
export function useLeads(params: LeadsFilterParams = {}) {
  const { page = 0, searchQuery, filterOrigin, filterRating } = params;
  const { organizationId, isReady } = useOrganization();

  useRealtimeSubscription("leads", ["leads", "pipe_whatsapp", "pipe_confirmacao", "pipe_propostas", "tv-dashboard"]);

  return useQuery({
    queryKey: ["leads", organizationId, page, searchQuery, filterOrigin, filterRating],
    queryFn: async () => {
      if (!organizationId) {
        console.warn("[useLeads] No organization_id available - returning empty array");
        return [];
      }

      const from = page * LEADS_PAGE_SIZE;
      const to = from + LEADS_PAGE_SIZE - 1;

      let query = supabase
        .from("leads")
        .select(`
          *,
          responsible:team_members!leads_responsible_id_fkey(id, name),
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `);

      query = applyLeadsFilters(query, organizationId, { searchQuery, filterOrigin, filterRating });

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data;
    },
    enabled: isReady,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

/**
 * Hook para contar total de leads (para paginação) — COM OS MESMOS FILTROS
 */
export function useLeadsCount(filters: Omit<LeadsFilterParams, "page"> = {}) {
  const { searchQuery, filterOrigin, filterRating } = filters;
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["leads-count", organizationId, searchQuery, filterOrigin, filterRating],
    queryFn: async () => {
      if (!organizationId) return 0;

      let query = supabase
        .from("leads")
        .select("*", { count: "exact", head: true });

      query = applyLeadsFilters(query, organizationId, { searchQuery, filterOrigin, filterRating });

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isReady,
    staleTime: 60000, // 1 minuto
  });
}

export { LEADS_PAGE_SIZE };

/**
 * Create a new lead
 * SECURITY: Automatically sets organization_id from current user's context
 * Never trust organization_id from client input
 */
export function useCreateLead() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: createPermission } = useCanPerformActionAsync("create_lead");

  return useMutation({
    mutationFn: async (lead: LeadInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create lead: No organization context");
      }
      if (createPermission && !createPermission.allowed) {
        throw new Error("Sem permissão para criar leads");
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      track({ event: "lead_created", organizationId: organizationId!, entityType: "lead", entityId: data.id });
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

      // Sync responsible_id to all pipe tables that contain this lead
      if (safeUpdates.responsible_id !== undefined) {
        const responsibleUpdate = { responsible_id: safeUpdates.responsible_id || null };
        await supabase.from("pipe_whatsapp").update(responsibleUpdate).eq("lead_id", id);
        await supabase.from("pipe_confirmacao").update(responsibleUpdate).eq("lead_id", id);
        await supabase.from("pipe_propostas").update(responsibleUpdate).eq("lead_id", id);
      }

      return data;
    },
    onSuccess: () => {
      // refetchType: 'active' — só refaz queries atualmente renderizadas (evita cascata de refetch em todas as páginas)
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"], refetchType: 'active' });
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

      // PERMISSION: Verificar can_delete_leads antes de prosseguir
      const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
        p_permission_key: "can_delete_leads",
      });
      if (canDelete !== true) {
        throw new Error("Você não tem permissão para excluir leads");
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

const BATCH_SIZE = 200;
const FETCH_PAGE_SIZE = 1000;

/**
 * Fetch all lead ids for the organization, including:
 * - leads.organization_id = org (base de leads)
 * - lead_id present in pipe_whatsapp / pipe_confirmacao / pipe_propostas for this org (todos que estão no funil/etapa)
 * Uses pagination so no row limit (e.g. 30/1000) cuts the list.
 * SECURITY: Only returns ids for the given organization_id.
 */
async function fetchAllLeadIdsForOrganization(
  organizationId: string
): Promise<string[]> {
  const idSet = new Set<string>();

  const fetchPage = async (table: string, orderBy: string, selectCol: string): Promise<void> => {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(selectCol)
        .eq("organization_id", organizationId)
        .order(orderBy, { ascending: true })
        .range(offset, offset + FETCH_PAGE_SIZE - 1);
      if (error) throw error;
      const list = (data ?? []).map((r: Record<string, string>) => r[selectCol]).filter(Boolean);
      list.forEach((id) => idSet.add(id));
      if (list.length < FETCH_PAGE_SIZE) break;
      offset += FETCH_PAGE_SIZE;
    }
  };

  const fetchLeadsPage = async (): Promise<void> => {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("leads")
        .select("id")
        .eq("organization_id", organizationId)
        .order("id", { ascending: true })
        .range(offset, offset + FETCH_PAGE_SIZE - 1);
      if (error) throw error;
      const list = (data ?? []).map((r: { id: string }) => r.id);
      list.forEach((id) => idSet.add(id));
      if (list.length < FETCH_PAGE_SIZE) break;
      offset += FETCH_PAGE_SIZE;
    }
  };

  await Promise.all([
    fetchLeadsPage(),
    fetchPage("pipe_whatsapp", "lead_id", "lead_id"),
    fetchPage("pipe_confirmacao", "lead_id", "lead_id"),
    fetchPage("pipe_propostas", "lead_id", "lead_id"),
  ]);

  return Array.from(idSet);
}

const PIPE_TABLES = {
  whatsapp: "pipe_whatsapp",
  propostas: "pipe_propostas",
  confirmacao: "pipe_confirmacao",
} as const;

export type PipeTypeForDelete = keyof typeof PIPE_TABLES;

/**
 * Fetch all lead_ids that are in a given pipe (funnel/stage) for the organization.
 * SECURITY: Only returns ids for the given organization_id; uses pagination.
 */
async function fetchAllLeadIdsInPipe(
  organizationId: string,
  pipeType: PipeTypeForDelete
): Promise<string[]> {
  const table = PIPE_TABLES[pipeType];
  const idSet = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("lead_id")
      .eq("organization_id", organizationId)
      .order("lead_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    const list = (data ?? []).map((r: { lead_id: string }) => r.lead_id).filter(Boolean);
    list.forEach((id) => idSet.add(id));
    if (list.length < FETCH_PAGE_SIZE) break;
    offset += FETCH_PAGE_SIZE;
  }
  return Array.from(idSet);
}

function deleteLeadsAndRelated(ids: string[]): Promise<void> {
  return (async () => {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const { data: propostaRows } = await supabase
        .from("pipe_propostas")
        .select("id")
        .in("lead_id", batch);
      const propostaIds = (propostaRows ?? []).map((x: { id: string }) => x.id);
      if (propostaIds.length > 0) {
        for (let j = 0; j < propostaIds.length; j += BATCH_SIZE) {
          const propBatch = propostaIds.slice(j, j + BATCH_SIZE);
          await supabase.from("pipe_proposta_items").delete().in("pipe_proposta_id", propBatch);
        }
      }
      await supabase.from("lead_tags").delete().in("lead_id", batch);
      await supabase.from("lead_history").delete().in("lead_id", batch);
      await supabase.from("follow_ups").delete().in("lead_id", batch);
      await supabase.from("acoes_do_dia").delete().in("lead_id", batch);
      await supabase.from("campanha_leads").delete().in("lead_id", batch);
      await supabase.from("lead_scores").delete().in("lead_id", batch);
      await supabase.from("leads_reativacao").delete().in("lead_id", batch);
      await supabase.from("pipe_whatsapp").delete().in("lead_id", batch);
      await supabase.from("pipe_confirmacao").delete().in("lead_id", batch);
      await supabase.from("pipe_propostas").delete().in("lead_id", batch);
    }
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const { error: deleteError } = await supabase.from("leads").delete().in("id", batch);
      if (deleteError) throw deleteError;
    }
  })();
}

/**
 * Delete ALL leads that are in THIS pipe (funnel/stage) only — not the whole organization.
 * SECURITY: Only deletes leads for current organization_id; uses pagination so all rows in the pipe are considered.
 */
export function useDeleteAllLeadsInPipe(pipeType: PipeTypeForDelete) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) {
        throw new Error("Cannot delete leads: No organization context");
      }

      // PERMISSION: Verificar can_delete_leads
      const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
        p_permission_key: "can_delete_leads",
      });
      if (canDelete !== true) {
        throw new Error("Você não tem permissão para excluir leads");
      }

      const ids = await fetchAllLeadIdsInPipe(organizationId, pipeType);
      if (ids.length === 0) return { deleted: 0 };

      await deleteLeadsAndRelated(ids);
      return { deleted: ids.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
    },
  });
}

/**
 * Delete ALL leads of the current organization and all related records (geral — toda a organização).
 * Excludes every lead that belongs to the org: both in the leads base and all that appear in any funnel (stage).
 * SECURITY: Only deletes leads for current organization_id; uses pagination so all rows are considered.
 */
export function useDeleteAllLeads() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) {
        throw new Error("Cannot delete leads: No organization context");
      }

      // PERMISSION: Verificar can_delete_leads
      const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
        p_permission_key: "can_delete_leads",
      });
      if (canDelete !== true) {
        throw new Error("Você não tem permissão para excluir leads");
      }

      const ids = await fetchAllLeadIdsForOrganization(organizationId);
      if (ids.length === 0) return { deleted: 0 };

      await deleteLeadsAndRelated(ids);
      return { deleted: ids.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
    },
  });
}

/**
 * Read ai_disabled status for a lead via SECURITY DEFINER RPC.
 * Bypasses RLS — always returns the real DB value regardless of
 * whether the user has SELECT permission on the lead via RLS.
 */
export function useLeadAiStatus(leadId: string | undefined) {
  return useQuery({
    queryKey: ["lead_ai_status", leadId],
    queryFn: async () => {
      if (!leadId) return { ai_disabled: false };
      const { data, error } = await supabase.rpc("get_lead_ai_status", {
        p_lead_id: leadId,
      });
      if (error) {
        console.error("[useLeadAiStatus] RPC error:", error);
        return { ai_disabled: false };
      }
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      return { ai_disabled: parsed?.ai_disabled ?? false };
    },
    enabled: !!leadId,
    staleTime: 30_000, // 30s — evita refetch excessivo
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

      // Use RPC to bypass leads RLS — any team member can toggle copilot
      const { data, error } = await supabase.rpc("toggle_lead_ai", {
        p_lead_id: leadId,
        p_disabled: disabled,
      });

      if (error) {
        console.error("[toggleLeadAI] RPC error:", error.message, error.code, error.details);
        throw new Error(error.message || "Erro desconhecido ao alterar IA");
      }

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
      // Atualizar cache DIRETAMENTE com o valor confirmado pelo servidor.
      // NÃO invalidar lead_by_phone nem lead-detail: a invalidação dispara
      // um refetch que passa pelo RLS, e o RLS pode bloquear o SELECT para
      // usuários que não são SDR/closer/responsible do lead — sobrescrevendo
      // o cache correto com null e fazendo o switch reverter.
      const updateAiDisabled = (old: any) => {
        if (!old) return old;
        if (old.id === variables.leadId) {
          return { ...old, ai_disabled: variables.disabled };
        }
        return old;
      };

      // Atualizar lead_by_phone (usado no WhatsAppChat)
      const queryCache = queryClient.getQueryCache();
      queryCache.findAll({ queryKey: ["lead_by_phone"] }).forEach((query) => {
        queryClient.setQueryData(query.queryKey, updateAiDisabled);
      });

      // Atualizar lead-detail (usado nos modais)
      queryClient.setQueryData(["lead-detail", variables.leadId], updateAiDisabled);

      // Atualizar lista de leads
      queryClient.setQueryData(["leads", organizationId], (old: any) => {
        if (!old) return old;
        return old.map((lead: Lead) =>
          lead.id === variables.leadId
            ? { ...lead, ai_disabled: variables.disabled }
            : lead
        );
      });

      // Atualizar pipes
      const updatePipe = (old: any) => {
        if (!old) return old;
        return old.map((item: any) =>
          (item.leadId === variables.leadId || item.lead_id === variables.leadId)
            ? { ...item, ai_disabled: variables.disabled }
            : item
        );
      };
      queryClient.setQueryData(["pipe_whatsapp"], updatePipe);
      queryClient.setQueryData(["pipe_confirmacao"], updatePipe);
      queryClient.setQueryData(["pipe_propostas"], updatePipe);

      // Atualizar lead_ai_status diretamente (fonte de verdade do switch)
      queryClient.setQueryData(["lead_ai_status", variables.leadId], {
        ai_disabled: variables.disabled,
      });

      // Invalidar APENAS queries que NÃO usam RLS de leads para refetch
      queryClient.invalidateQueries({ queryKey: ["conversation-history", variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-human-leads"], refetchType: 'active' });
    },
  });
}

/**
 * Toggle AI for a conversation by phone number.
 * If no lead exists, creates a shadow lead automatically.
 * Use this when the user wants to disable AI for a contact that has no lead card.
 */
export function useToggleConversationAI() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ phone, disabled }: { phone: string; disabled: boolean }) => {
      const { data, error } = await supabase.rpc("toggle_conversation_ai", {
        p_phone: phone,
        p_disabled: disabled,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead_by_phone"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["waiting-human-leads"], refetchType: "active" });
      if (data && typeof data === "object" && "id" in data) {
        queryClient.invalidateQueries({ queryKey: ["lead-detail", (data as any).id] });
      }
    },
  });
}
