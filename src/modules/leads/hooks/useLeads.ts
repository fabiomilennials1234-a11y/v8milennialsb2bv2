import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { useOrganization } from "@/modules/identity";
import { track } from "@/lib/analytics";
import { useCanDo } from "@/modules/identity";
import { normalizePhone } from "@/lib/normalizePhone";
import { useIdentity } from "@/modules/identity";
import { OptimisticLockConflictError, isPostgrestNoRows } from "@/modules/platform/lib/optimistic-lock";
import { applyLeadListFilters } from "../lib/lead-list-filters";
import { applyLeadListSort, DEFAULT_LEAD_SORT, type LeadListSort } from "../lib/lead-list-sort";

export type Lead = Tables<"leads">;
export type LeadInsert = TablesInsert<"leads">;
export type LeadUpdate = TablesUpdate<"leads">;

const LEADS_PAGE_SIZE = 50;

export interface LeadsFilterParams {
  page?: number;
  searchQuery?: string;
  filterOrigin?: string;
  filterQualification?: string;
  /** Gaveta: lead | cliente | indefinido, ou "all". Recorta no BANCO. */
  filterClassificacao?: string;
  /** Aba aberta: "leads" (nao comprou) | "clientes" (comprou) | "todos". */
  filterRelacao?: "todos" | "leads" | "clientes";
  filterUf?: string;
  /** Instante ISO (inclusive) — limite inferior de `created_at`. */
  createdFrom?: string;
  /** Instante ISO (inclusive) — limite superior de `created_at`. */
  createdTo?: string;
  /**
   * Ordenação da lista (ADR-0024 decisão 2). Catálogo fechado e regra de
   * desempate em `../lib/lead-list-sort`. Ausente = a ordem de sempre.
   *
   * Só `useLeads` usa. `useLeadsCount` não recebe de propósito: contagem não
   * depende de ordem, e incluí-la lá invalidaria o cache do total a cada
   * clique no cabeçalho — três `count(*)` a mais por clique, de graça.
   */
  sort?: LeadListSort;
  /** `"unassigned"` recorta leads sem responsável nas quatro colunas. */
  filterAssignment?: "all" | "unassigned";
  /**
   * Dono da conta: id de `team_member`, `"all"` (sem filtro) ou `"none"` (sem
   * dono). Semântica — e a razão de não ser o mesmo que `filterAssignment` —
   * em `../lib/lead-list-filters`.
   */
  filterResponsible?: string;
}

/**
 * Apply shared filters (tenancy + list filters) to a Supabase query builder.
 * Used by both useLeads and useLeadsCount to ensure consistency.
 *
 * A semântica dos filtros visíveis vive em `applyLeadListFilters`
 * (`../lib/lead-list-filters`) — fonte única compartilhada com a exportação.
 */
function applyLeadsFilters(
  query: any,
  organizationId: string,
  filters: Omit<LeadsFilterParams, "page">
) {
  query = query
    .eq("organization_id", organizationId)
    .or("is_shadow.is.null,is_shadow.eq.false");
  return applyLeadListFilters(query, filters);
}

/**
 * Fetch leads filtered by current user's organization — COM PAGINAÇÃO E FILTROS SERVER-SIDE
 * SECURITY: Always filters by organization_id to ensure data isolation
 * Retorna até LEADS_PAGE_SIZE leads por página.
 */
export function useLeads(params: LeadsFilterParams = {}) {
  const { page = 0, searchQuery, filterOrigin, filterQualification, filterClassificacao, filterRelacao, filterUf, createdFrom, createdTo, filterAssignment, filterResponsible, sort = DEFAULT_LEAD_SORT } = params;
  const { organizationId, isReady } = useOrganization();

  useRealtimeSubscription("leads", ["leads"]);

  return useQuery({
    // Ordem e recorte entram na chave junto com filtros e pagina. Sem sort.*,
    // o cache devolve a pagina da ordem antiga; sem filterAssignment, mistura
    // "todos" com "sem responsavel". Espalhados (e nao como objeto) para a
    // chave continuar legivel no devtools.
    queryKey: ["leads", organizationId, page, searchQuery, filterOrigin, filterQualification, filterClassificacao, filterRelacao, filterUf, createdFrom, createdTo, filterAssignment, filterResponsible, sort.key, sort.direction],
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
          pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
          sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `);

      query = applyLeadsFilters(query, organizationId, { searchQuery, filterOrigin, filterQualification, filterClassificacao, filterRelacao, filterUf, createdFrom, createdTo, filterAssignment, filterResponsible });

      // Sempre com desempate por `id` — ver `lib/lead-list-sort`. Sem ele a
      // paginação por OFFSET repete linha entre páginas dentro de um empate,
      // e em prod há um grupo de 643 leads com o mesmo `created_at`.
      const { data, error } = await applyLeadListSort(query, sort).range(from, to);

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
  const { searchQuery, filterOrigin, filterQualification, filterClassificacao, filterRelacao, filterUf, createdFrom, createdTo, filterAssignment, filterResponsible } = filters;
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["leads-count", organizationId, searchQuery, filterOrigin, filterQualification, filterClassificacao, filterRelacao, filterUf, createdFrom, createdTo, filterAssignment, filterResponsible],
    queryFn: async () => {
      if (!organizationId) return 0;

      let query = supabase
        .from("leads")
        .select("*", { count: "exact", head: true });

      query = applyLeadsFilters(query, organizationId, { searchQuery, filterOrigin, filterQualification, filterClassificacao, filterRelacao, filterUf, createdFrom, createdTo, filterAssignment, filterResponsible });

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
 * Busca UM lead pelo id, com os mesmos joins que `useLeadByPhone` traz.
 *
 * POR QUE EXISTE. O painel de contexto do chat sempre resolveu o lead a partir
 * do TELEFONE (`useLeadByPhone`) — o que bastava enquanto todo canal do inbox
 * era WhatsApp. Uma conversa de Instagram não tem telefone e mesmo assim pode
 * ter lead: o vínculo vive em `lead_social_identities` e chega ao front já
 * resolvido como `lead_id`. Sem este hook o painel teria o id e nenhuma forma
 * de carregar a ficha.
 *
 * O shape devolvido é DELIBERADAMENTE o mesmo de `useLeadByPhone`, porque os
 * dois alimentam exatamente os mesmos consumidores (`ContextPanelTabInfo`,
 * header do painel). Dois shapes para o mesmo painel seria a próxima
 * divergência.
 *
 * SECURITY: filtra por `organization_id` — id de lead é adivinhável o bastante
 * para não ser credencial. `deleted_at` fora: lead na lixeira não é lead.
 */
export function useLeadById(leadId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["lead_by_id", leadId, organizationId],
    queryFn: async () => {
      if (!leadId || !organizationId) return null;

      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          responsible:team_members!leads_responsible_id_fkey(id, name),
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(tag:tags(id, name, color))
        `)
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        console.error("Erro ao buscar lead por id:", error);
        return null;
      }

      return data;
    },
    enabled: !!leadId && !!organizationId && isReady,
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
  const createPermission = useCanDo("create_lead");

  return useMutation({
    mutationFn: async (lead: LeadInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create lead: No organization context");
      }
      if (!createPermission.allowed) {
        throw new Error(createPermission.isLoading
          ? "Permissões ainda carregando — tente novamente"
          : "Sem permissão para criar leads");
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
    mutationFn: async ({
      id,
      expectedUpdatedAt,
      ...updates
    }: LeadUpdate & { id: string; expectedUpdatedAt?: string }) => {
      if (!organizationId) {
        throw new Error("Cannot update lead: No organization context");
      }

      // SECURITY: Remove organization_id from updates to prevent tampering
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { organization_id: _, ...safeUpdates } = updates as LeadUpdate & { organization_id?: string };

      // Optimistic lock (#307): when caller passes the original
      // updated_at, the UPDATE is conditional on it still matching —
      // a concurrent write nullifies the row count and PostgREST
      // returns PGRST116 from .single().
      let query = supabase
        .from("leads")
        .update(safeUpdates)
        .eq("id", id)
        // SECURITY: Ensure lead belongs to user's organization
        .eq("organization_id", organizationId);
      if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await query.select().single();

      if (error) {
        if (expectedUpdatedAt && isPostgrestNoRows(error)) {
          throw new OptimisticLockConflictError();
        }
        throw error;
      }

      // Sync responsible_id to all pipe tables that contain this lead
      if (safeUpdates.responsible_id !== undefined) {
        const responsibleUpdate = { responsible_id: safeUpdates.responsible_id || null };
        await supabase.from("pipe_whatsapp").update(responsibleUpdate).eq("lead_id", id);
        await supabase.from("pipe_confirmacao").update(responsibleUpdate).eq("lead_id", id);
        await supabase.from("pipe_propostas").update(responsibleUpdate).eq("lead_id", id);
      }

      // Sync pre_sale_responsible_id / sale_responsible_id to all pipe tables
      if (safeUpdates.pre_sale_responsible_id !== undefined || safeUpdates.sale_responsible_id !== undefined) {
        const pipeUpdate: Record<string, unknown> = {};
        if (safeUpdates.pre_sale_responsible_id !== undefined) {
          pipeUpdate.pre_sale_responsible_id = safeUpdates.pre_sale_responsible_id || null;
        }
        if (safeUpdates.sale_responsible_id !== undefined) {
          pipeUpdate.sale_responsible_id = safeUpdates.sale_responsible_id || null;
        }
        if (Object.keys(pipeUpdate).length > 0) {
          await supabase.from("pipe_whatsapp").update(pipeUpdate).eq("lead_id", id);
          await supabase.from("pipe_confirmacao").update(pipeUpdate).eq("lead_id", id);
          await supabase.from("pipe_propostas").update(pipeUpdate).eq("lead_id", id);
        }
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
    onSuccess: (_data, variables) => {
      // refetchType: 'active' — só refaz queries atualmente renderizadas (evita cascata de refetch em todas as páginas)
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"], refetchType: 'active' });
      /**
       * As três chaves abaixo são as que a tela realmente lê, e nenhuma delas
       * casa com as duas de cima:
       *
       * - `["lead-detail", id]` é o que a COLUNA DO LEAD do painel lê
       *   (`useLeadDetail`). Sem esta linha o campo editado grava no banco e
       *   volta ao valor antigo na própria linha, porque `useInlineEdit` repõe
       *   o dado do servidor ao sair da edição — e o usuário conclui que a
       *   gravação falhou.
       * - `["pipeline-page"]` é a RPC `get_pipeline_page` de que os boards
       *   vivem (`usePaginatedPipeline`). Sem ela o card atrás do painel fica
       *   com o valor velho até um F5 — e o mesmo vale para a edição inline
       *   nos três boards, que chama este hook direto.
       *
       * Strings literais de propósito: importar as chaves de `modules/pipelines`
       * reabriria o ciclo leads↔pipelines que o dependency-cruiser barra.
       */
      queryClient.invalidateQueries({ queryKey: ["lead-detail", variables.id], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["pipeline-page"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts"], refetchType: 'active' });
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
  const { isAdmin, isMaster } = useIdentity();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) {
        throw new Error("Cannot delete lead: No organization context");
      }

      if (!isMaster && !isAdmin) {
        const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
          p_permission_key: "can_delete_leads",
        });
        if (canDelete !== true) {
          throw new Error("Você não tem permissão para excluir leads");
        }
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
      
      // Soft-delete (move to trash) via the same RPC the bulk paths use.
      // Sets deleted_at + deleted_by (recoverable + records WHO deleted) and clears
      // pipeline entries so the kanban is clean, while PRESERVING the lead and its
      // conversation/history/meetings so it can be restored from the trash page.
      // Previously this hard-deleted the row + all dependents (irreversible, untracked).
      const { error } = await supabase.rpc("bulk_delete_leads", { p_lead_ids: [id] });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
    },
  });
}

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

/**
 * Soft-delete leads in a specific stage of this pipe (moves to trash).
 * Leads can be restored from the trash page or permanently purged.
 * SECURITY: Only deletes leads for current organization_id; permission check enforced.
 */
export function useDeleteAllLeadsInPipe(pipeType: PipeTypeForDelete) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { isAdmin, isMaster } = useIdentity();

  return useMutation({
    mutationFn: async ({ stageId }: { stageId: string }) => {
      if (!organizationId) {
        throw new Error("Cannot delete leads: No organization context");
      }

      if (!stageId) {
        throw new Error("Cannot delete leads: No stage specified");
      }

      if (!isMaster && !isAdmin) {
        const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
          p_permission_key: "can_delete_leads",
        });
        if (canDelete !== true) {
          throw new Error("Você não tem permissão para excluir leads");
        }
      }

      const ids = await fetchAllLeadIdsInPipe(organizationId, pipeType, stageId);
      if (ids.length === 0) return { deleted: 0 };

      const { data, error } = await supabase.rpc("bulk_delete_leads" as any, {
        p_lead_ids: ids,
      });
      if (error) throw error;
      return { deleted: (data as number) ?? ids.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["trash_leads"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
    },
  });
}

/**
 * Soft-delete ALL leads of the current organization (moves to trash).
 * SECURITY: Only deletes leads for current organization_id; uses pagination.
 */
export function useDeleteAllLeads() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { isAdmin, isMaster } = useIdentity();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) {
        throw new Error("Cannot delete leads: No organization context");
      }

      if (!isMaster && !isAdmin) {
        const { data: canDelete } = await supabase.rpc("user_has_org_permission", {
          p_permission_key: "can_delete_leads",
        });
        if (canDelete !== true) {
          throw new Error("Você não tem permissão para excluir leads");
        }
      }

      const ids = await fetchAllLeadIdsForOrganization(organizationId);
      if (ids.length === 0) return { deleted: 0 };

      const { data, error } = await supabase.rpc("bulk_delete_leads" as any, {
        p_lead_ids: ids,
      });
      if (error) throw error;
      return { deleted: (data as number) ?? ids.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["trash_leads"] });
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
  const { isMaster } = useIdentity();

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
      await queryClient.cancelQueries({ queryKey: ["pipeline_entries"] });
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
      // usuários que não são responsáveis do lead — sobrescrevendo
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
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["waiting-human-leads"], refetchType: "active" });
    },
  });
}
