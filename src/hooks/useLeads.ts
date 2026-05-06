import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";
import { track } from "@/lib/analytics";
import { useCanPerformActionAsync } from "@/lib/permissions";
import { normalizePhone } from "@/lib/normalizePhone";
import { useMasterAuth } from "./useMasterAuth";

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

  useRealtimeSubscription("leads", ["leads"]);

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

      // Sync compromisso_date → pipe_confirmacao.meeting_date (espelho inverso).
      // Best-effort: pode não existir entrada em pipe_confirmacao para esse lead — nesse
      // caso UPDATE afeta 0 linhas sem erro. Nunca usar upsert/insert aqui (Security: D5).
      // Payload literal — nunca spread; nunca tocar em status neste caminho.
      if (safeUpdates.compromisso_date !== undefined) {
        const { error: syncErr } = await supabase
          .from("pipe_confirmacao")
          .update({ meeting_date: safeUpdates.compromisso_date })
          .eq("lead_id", id)
          .eq("organization_id", organizationId);
        if (syncErr) {
          console.warn(
            "[useUpdateLead] failed to sync compromisso_date → pipe_confirmacao.meeting_date",
            syncErr,
          );
        }
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
      
      // Delete all dependent records (upsell, pipes, tags, history, etc.)
      await cleanupLeadDependencies([id]);

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
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
    },
  });
}

const BATCH_SIZE = 200;
const FETCH_PAGE_SIZE = 1000;

/**
 * Cleanup all dependent records for a list of lead IDs before deleting the leads themselves.
 * Handles upsell tables (which have ON DELETE RESTRICT) first, then all other FKs.
 * SECURITY: Relies on RLS — caller must already have verified org ownership.
 */
async function cleanupLeadDependencies(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    // 1. Upsell tables — must be deleted before leads due to ON DELETE RESTRICT on upsell_clients.lead_id
    // Fetch upsell_client IDs for this batch of leads
    const { data: upsellClientRows } = await supabase
      .from("upsell_clients")
      .select("id")
      .in("lead_id", batch);
    const upsellClientIds = (upsellClientRows ?? []).map((x: { id: string }) => x.id);

    if (upsellClientIds.length > 0) {
      for (let j = 0; j < upsellClientIds.length; j += BATCH_SIZE) {
        const ucBatch = upsellClientIds.slice(j, j + BATCH_SIZE);
        // Delete children of upsell_clients (these CASCADE but we clean explicitly for safety)
        await supabase.from("upsell_orders").delete().in("client_id", ucBatch);
        await supabase.from("upsell_campanhas").delete().in("client_id", ucBatch);
        await supabase.from("upsell_client_products").delete().in("client_id", ucBatch);
      }
      // Now delete the upsell_clients themselves
      for (let j = 0; j < upsellClientIds.length; j += BATCH_SIZE) {
        const ucBatch = upsellClientIds.slice(j, j + BATCH_SIZE);
        await supabase.from("upsell_clients").delete().in("id", ucBatch);
      }
    }

    // 2. pipe_proposta_items (via pipe_propostas)
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

    // 3. All other lead-dependent tables
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
    await supabase.from("custom_pipe_entries").delete().in("lead_id", batch);
  }
}

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
 * Fetch all lead_ids that are in a given pipe for the organization.
 * When stageId is provided, only returns leads in that specific stage (status).
 * SECURITY: Only returns ids for the given organization_id; uses pagination.
 */
async function fetchAllLeadIdsInPipe(
  organizationId: string,
  pipeType: PipeTypeForDelete,
  stageId?: string
): Promise<string[]> {
  const table = PIPE_TABLES[pipeType];
  const idSet = new Set<string>();
  let offset = 0;
  while (true) {
    let query = supabase
      .from(table)
      .select("lead_id")
      .eq("organization_id", organizationId);
    if (stageId) {
      query = query.eq("status", stageId);
    }
    const { data, error } = await query
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
    // Clean up all dependent records (upsell, pipes, tags, history, etc.)
    await cleanupLeadDependencies(ids);

    // Now delete the leads themselves
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const { error: deleteError } = await supabase.from("leads").delete().in("id", batch);
      if (deleteError) throw deleteError;
    }
  })();
}

/**
 * Delete leads that are in a specific stage of this pipe.
 * When stageId is provided, only leads in that stage are deleted.
 * SECURITY: Only deletes leads for current organization_id; permission check enforced.
 */
export function useDeleteAllLeadsInPipe(pipeType: PipeTypeForDelete) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ stageId }: { stageId: string }) => {
      if (!organizationId) {
        throw new Error("Cannot delete leads: No organization context");
      }

      if (!stageId) {
        throw new Error("Cannot delete leads: No stage specified");
      }

      // PERMISSION: Verificar can_delete_leads
      const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
        p_permission_key: "can_delete_leads",
      });
      if (canDelete !== true) {
        throw new Error("Você não tem permissão para excluir leads");
      }

      const ids = await fetchAllLeadIdsInPipe(organizationId, pipeType, stageId);
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
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
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
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
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
 *
 * H4 2026-04-26: rota Master Admin (cross-org) → master_set_copilot_disabled.
 * Member normal → toggle_lead_ai (valida membership na org do lead, H1 fix).
 */
export function useToggleLeadAI() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { isMaster } = useMasterAuth();

  return useMutation({
    mutationFn: async ({ leadId, disabled }: { leadId: string; disabled: boolean }) => {
      if (!organizationId && !isMaster) {
        throw new Error("Cannot update lead: No organization context");
      }

      const rpcName = isMaster ? "master_set_copilot_disabled" : "toggle_lead_ai";
      const { data, error } = await supabase.rpc(rpcName, {
        p_lead_id: leadId,
        p_disabled: disabled,
      });

      if (error) {
        console.error(`[toggleLeadAI] ${rpcName} RPC error:`, error.message, error.code, error.details);
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
      await queryClient.cancelQueries({ queryKey: ["lead_ai_status", leadId] });
      await queryClient.cancelQueries({ queryKey: ["phone_ai_status"] });

      // Snapshot do estado anterior
      const previousLeadDetail = queryClient.getQueryData(["lead-detail", leadId]);
      const previousLeads = queryClient.getQueryData(["leads", organizationId]);
      const previousPipeWhatsapp = queryClient.getQueryData(["pipe_whatsapp"]);
      const previousPipeConfirmacao = queryClient.getQueryData(["pipe_confirmacao"]);
      const previousPipePropostas = queryClient.getQueryData(["pipe_propostas"]);
      const previousLeadAiStatus = queryClient.getQueryData(["lead_ai_status", leadId]);
      
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
      
      // Atualização otimista do lead_ai_status (fonte de verdade da Switch no chat)
      queryClient.setQueryData(["lead_ai_status", leadId], {
        ai_disabled: disabled,
      });

      // Retornar contexto para rollback em caso de erro
      return {
        previousLeadDetail,
        previousLeads,
        previousPipeWhatsapp,
        previousPipeConfirmacao,
        previousPipePropostas,
        previousLeadByPhone,
        previousLeadAiStatus,
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
      // Rollback do lead_ai_status (fonte da Switch no chat)
      if (context?.previousLeadAiStatus !== undefined) {
        queryClient.setQueryData(["lead_ai_status", variables.leadId], context.previousLeadAiStatus);
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
 * Read ai_disabled status by phone number (works without a lead).
 *
 * Priority chain:
 *   1. phone_ai_preferences (source of truth, set by toggle_phone_ai)
 *   2. leads.ai_disabled (fallback for legacy leads without preference)
 *   3. default false
 *
 * Bypasses RLS via SECURITY DEFINER RPC (get_phone_ai_status) so the
 * hook returns the real state regardless of whether the user has SELECT
 * on a specific lead.
 */
export function usePhoneAiStatus(phone: string | undefined | null) {
  const { organizationId } = useOrganization();
  const normalized = normalizePhone(phone ?? null);

  return useQuery({
    queryKey: ["phone_ai_status", organizationId, normalized],
    queryFn: async () => {
      if (!phone) return { ai_disabled: false, source: "default" as const };
      const { data, error } = await supabase.rpc("get_phone_ai_status", {
        p_phone: phone,
      });
      if (error) {
        console.error("[usePhoneAiStatus] RPC error:", error);
        return { ai_disabled: false, source: "error" as const };
      }
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      return {
        ai_disabled: parsed?.ai_disabled ?? false,
        source: (parsed?.source as string) ?? "default",
        normalized_phone: parsed?.normalized_phone ?? null,
        lead_id: parsed?.lead_id ?? null,
      };
    },
    enabled: !!phone && !!organizationId,
    staleTime: 30_000,
  });
}

/**
 * Toggle AI for a conversation by phone number.
 *
 * Persists to `phone_ai_preferences` (source of truth) via `toggle_phone_ai`
 * RPC. If leads already exist with the same normalized_phone, their
 * `ai_disabled` is synced too. Does NOT create any shadow lead — the
 * preference exists independently of a lead entity.
 *
 * When the contact later sends their first message, `getOrCreateLead`
 * reads the preference and honors it on lead creation.
 */
export function useToggleConversationAI() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ phone, disabled }: { phone: string; disabled: boolean }) => {
      const { data, error } = await supabase.rpc("toggle_phone_ai", {
        p_phone: phone,
        p_disabled: disabled,
      });
      if (error) {
        console.error("[useToggleConversationAI] RPC error:", error.message, error.code);
        throw new Error(error.message || "Erro ao alterar Copilot");
      }
      return data;
    },
    onMutate: async ({ phone, disabled }) => {
      const normalized = normalizePhone(phone);
      const phoneKey = ["phone_ai_status", organizationId, normalized] as const;

      await queryClient.cancelQueries({ queryKey: phoneKey });
      await queryClient.cancelQueries({ queryKey: ["lead_by_phone"] });

      const previousPhoneStatus = queryClient.getQueryData(phoneKey);

      // Snapshot lead_ai_status of any lead that might match this phone, so
      // the chat Switch reflects the new state immediately even when leadId
      // is already known. We don't know the leadId here, so we snapshot the
      // full cache shape by query key.
      const previousLeadAiStatuses: Array<{ key: readonly unknown[]; value: unknown }> = [];
      const queryCache = queryClient.getQueryCache();
      queryCache.findAll({ queryKey: ["lead_ai_status"] }).forEach((q) => {
        previousLeadAiStatuses.push({ key: q.queryKey, value: queryClient.getQueryData(q.queryKey) });
      });

      // Optimistic update on phone-keyed status
      queryClient.setQueryData(phoneKey, {
        ai_disabled: disabled,
        source: "preference" as const,
        normalized_phone: normalized,
        lead_id: null,
      });

      return { previousPhoneStatus, previousLeadAiStatuses, phoneKey };
    },
    onError: (err, _vars, context) => {
      console.error("[useToggleConversationAI] Error:", err);
      if (context?.previousPhoneStatus !== undefined) {
        queryClient.setQueryData(context.phoneKey, context.previousPhoneStatus);
      }
      if (context?.previousLeadAiStatuses) {
        for (const snap of context.previousLeadAiStatuses) {
          queryClient.setQueryData(snap.key, snap.value);
        }
      }
    },
    onSuccess: (data, { phone, disabled }) => {
      const normalized = normalizePhone(phone);
      const phoneKey = ["phone_ai_status", organizationId, normalized] as const;

      // Reaffirm optimistic value with server-confirmed data
      const leadId = data && typeof data === "object" && "lead_id" in data ? (data as { lead_id: string | null }).lead_id : null;
      queryClient.setQueryData(phoneKey, {
        ai_disabled: disabled,
        source: "preference" as const,
        normalized_phone: normalized,
        lead_id: leadId,
      });

      // If the RPC touched leads (duplicates), sync their lead_ai_status caches
      if (leadId) {
        queryClient.setQueryData(["lead_ai_status", leadId], { ai_disabled: disabled });
      }

      queryClient.invalidateQueries({ queryKey: ["lead_by_phone"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["waiting-human-leads"], refetchType: "active" });
    },
  });
}
