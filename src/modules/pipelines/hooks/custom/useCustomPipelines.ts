import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { triggerLeadCreatedInCustomPipeline } from "@/lib/workflowTrigger";
import { useCanDo } from "@/modules/identity";
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
import {
  createCustomPipelineEntry,
  createSystemPipelineEntry,
  updateCustomPipelineEntry,
  updateSystemPipelineEntry,
} from "@/integrations/supabase/pipeline-entry-rpc";
import {
  createCustomPipelineStage,
  createCustomPipelineWithStages,
  updateCustomPipelineRecord,
  updateCustomPipelineStage,
} from "@/integrations/supabase/custom-pipeline-rpc";
import {
  proximaPosicaoDeEtapa,
  mensagemDeConflitoDeEtapa,
} from "@/modules/pipelines/lib/proxima-posicao-de-etapa";
// ────────────────────────────────────────────────────────────
// Types — definição canônica em contracts (puros, sem React/Supabase).
// Re-exportados aqui para manter a API pública do módulo inalterada.
// ────────────────────────────────────────────────────────────

import type {
  LifecycleType,
  FunnelStatus,
  FunnelTemplateType,
  CustomPipeline,
  CustomPipelineStage,
  CustomPipeEntry,
} from "@/contracts/pipe";
import type { Json } from "@/integrations/supabase/types";
export type {
  LifecycleType,
  FunnelStatus,
  FunnelTemplateType,
  CustomPipeline,
  CustomPipelineStage,
  CustomPipeEntry,
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateStageKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Etapas padrão para novos funis permanentes
const DEFAULT_CUSTOM_STAGES = [
  { name: "Novo", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
  { name: "Em andamento", color: "#eab308", is_final_positive: false, is_final_negative: false },
  { name: "Concluído", color: "#22c55e", is_final_positive: true, is_final_negative: false },
];

// Etapas padrão para funis temporários por template
export const TEMPORARY_FUNNEL_STAGES: Record<string, typeof DEFAULT_CUSTOM_STAGES> = {
  indicacao: [
    { name: "Indicado", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
    { name: "Contatado", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
    { name: "Qualificado", color: "#eab308", is_final_positive: false, is_final_negative: false },
    { name: "Convertido", color: "#22c55e", is_final_positive: true, is_final_negative: false },
  ],
  prospeccao: [
    { name: "Importado", color: "#64748b", is_final_positive: false, is_final_negative: false },
    { name: "Abordado", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
    { name: "Respondeu", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
    { name: "Qualificado", color: "#eab308", is_final_positive: false, is_final_negative: false },
    { name: "Convertido", color: "#22c55e", is_final_positive: true, is_final_negative: false },
  ],
  reativacao: [
    { name: "Selecionado", color: "#64748b", is_final_positive: false, is_final_negative: false },
    { name: "Reativado", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
    { name: "Em Negociação", color: "#eab308", is_final_positive: false, is_final_negative: false },
    { name: "Reconvertido", color: "#22c55e", is_final_positive: true, is_final_negative: false },
  ],
};

// ────────────────────────────────────────────────────────────
// Queries: Pipelines
// ────────────────────────────────────────────────────────────

/** Lista todos os funis customizados da organização */
export function useCustomPipelines() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["custom_pipelines", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("custom_pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("position", { ascending: true });

      if (error) throw error;
      return (data || []) as CustomPipeline[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutos — pipelines raramente mudam
  });
}

/** Lista funis customizados permanentes */
export function usePermanentCustomFunnels() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["custom_pipelines", organizationId, "permanent"],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("custom_pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("lifecycle_type", "permanent")
        .order("position", { ascending: true });

      if (error) throw error;
      return (data || []) as CustomPipeline[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Lista funis temporários (ativos, pausados, draft) */
export function useTemporaryFunnels() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["custom_pipelines", organizationId, "temporary"],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("custom_pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("lifecycle_type", "temporary")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as CustomPipeline[];
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000, // 1 min — temporary funnels change more often
  });
}

/** Lista funis temporários ativos (para sidebar) */
export function useActiveTemporaryFunnels() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["custom_pipelines", organizationId, "temporary", "active"],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("custom_pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("lifecycle_type", "temporary")
        .in("status", ["active", "paused", "draft"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as CustomPipeline[];
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });
}

/** Busca um funil customizado por slug */
export function useCustomPipeline(slug: string | undefined) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["custom_pipeline", slug, organizationId],
    queryFn: async () => {
      if (!organizationId || !slug) return null;

      const { data, error } = await supabase
        .from("custom_pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (error) throw error;
      return data as CustomPipeline;
    },
    enabled: !!organizationId && !!slug,
  });
}

// ────────────────────────────────────────────────────────────
// Queries: Stages
// ────────────────────────────────────────────────────────────

/** Busca etapas de um funil customizado */
export function useCustomPipelineStages(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ["custom_pipeline_stages", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("custom_pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .eq("is_active", true)
        .order("position", { ascending: true });

      if (error) throw error;
      return (data || []) as CustomPipelineStage[];
    },
    enabled: !!pipelineId,
  });
}

// ────────────────────────────────────────────────────────────
// Queries: Entries (leads no funil)
// ────────────────────────────────────────────────────────────

/** Busca leads de um funil customizado com joins */
export function useCustomPipeEntries(pipelineId: string | undefined) {
  // Realtime: a fonte única é pipeline_entries (SCRUM-621) — custom_pipe_entries
  // virou view e view não emite postgres_changes (aliás, nunca esteve na
  // publication: a subscription antiga era um no-op medido). Assinar a fonte
  // cobre import-leads, mutations no UI, triggers do banco etc.
  useRealtimeSubscription("pipeline_entries", ["custom_pipe_entries", pipelineId ?? ""]);

  return useQuery({
    queryKey: ["custom_pipe_entries", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      // FK assigned_to migrou de profiles → team_members (migration 20260918).
      // Faz 2-hop: team_members → profiles via team_members.user_id pra manter
      // o display name e avatar (compatibilidade com CustomPipeLeadCard).
      const { data, error } = await supabase
        .from("custom_pipe_entries")
        .select(`
          *,
          lead:leads(
            id, name, company, phone, email, origin, urgency, faturamento, notes,
            avatar_url, pre_qualification_tier, qualification_tier,
            responsible:team_members!leads_responsible_id_fkey(id, name, avatar_url),
            sdr:team_members!leads_sdr_id_fkey(id, name, avatar_url),
            closer:team_members!leads_closer_id_fkey(id, name, avatar_url),
            lead_tags(tag:tags(id, name, color))
          ),
          stage:custom_pipeline_stages(id, name, color, stage_key, position),
          assigned_member:team_members!pipeline_entries_assigned_to_fkey(
            id, name, user_id
          )
        `)
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Lookup batch dos profiles via user_id dos team_members (1 query
      // adicional, evita relação fixa que não existe em alguns ambientes).
      const userIds = Array.from(new Set(
        (data || [])
          .map((e: any) => e.assigned_member?.user_id)
          .filter((u: any): u is string => !!u)
      ));
      const profilesById = new Map<string, { id: string; full_name: string | null; avatar_url: string | null }>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds);
        for (const p of profs || []) profilesById.set(p.id, p);
      }

      // Backfill assigned_profile (legacy shape) a partir do assigned_member
      // pra os componentes que ainda referenciam entry.assigned_profile.
      const enriched = (data || []).map((entry: any) => {
        const member = entry.assigned_member;
        const prof = member?.user_id ? profilesById.get(member.user_id) : null;
        return {
          ...entry,
          assigned_profile: member
            ? {
                id: prof?.id || member.id,
                full_name: prof?.full_name || member.name || null,
                avatar_url: prof?.avatar_url || null,
              }
            : null,
        };
      });

      return enriched as CustomPipeEntry[];
    },
    enabled: !!pipelineId,
  });
}

/**
 * Contagem server-side de entries por stage de um funil custom.
 *
 * `useCustomPipeEntries` busca sem `.range()`, então o PostgREST corta em 1000
 * rows e o badge da coluna (que caía em `items.length`) travava em 1000. Este
 * hook chama a RPC `get_pipeline_stage_counts_by_id` (SCRUM-626: o motor único
 * de contagem por pipeline_id que fundiu o par system/custom) pra o total real
 * por stage — o MESMO motor que serve o board canônico.
 *
 * Sem busca → conta TODAS as entries por stage (inclusive lead_id null), igual
 * ao comportamento atual do badge. Com busca → narrow server-side por
 * nome/empresa/telefone (aproximado por acento; ver migration).
 *
 * Realtime: `useCustomPipeEntries` já assina `custom_pipe_entries` e as mutations
 * invalidam esta queryKey — o count acompanha insert/move/delete.
 *
 * @returns Record<stage_id, count>
 */
export function useCustomPipeStageCounts(
  pipelineId: string | undefined,
  searchQuery?: string,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const search = searchQuery?.trim() || null;

  return useQuery({
    queryKey: ["custom_pipe_stage_counts", pipelineId, search],
    queryFn: async () => {
      if (!pipelineId || !organizationId) return {} as Record<string, number>;

      // SCRUM-626: caminho por id — motor único get_pipeline_stage_counts_by_id
      // (funde o par system/custom; o wrapper get_custom_pipeline_stage_counts
      // segue vivo até a W6). `as any` no nome: RPC mais nova que o types.ts
      // gerado de prod (regen após a janela) — mesmo padrão de useFilteredLeadIds.
      const { data, error } = await supabase.rpc(
        "get_pipeline_stage_counts_by_id" as any,
        {
          p_pipeline_id: pipelineId,
          p_org_id: organizationId,
          // `search` chega `string | null` (null = sem filtro no motor).
          p_search: search,
        },
      );

      if (error) throw error;

      // O motor devolve (stage_id, stage_key, cnt) e separa linhas fantasma
      // (stage_id NULL); o badge é por stage_id — soma por segurança.
      const counts: Record<string, number> = {};
      for (const row of (data || []) as Array<{ stage_id: string | null; cnt: number }>) {
        if (row.stage_id) counts[row.stage_id] = (counts[row.stage_id] ?? 0) + Number(row.cnt);
      }
      return counts;
    },
    enabled: !!pipelineId && !!organizationId,
  });
}

// ────────────────────────────────────────────────────────────
// Mutations: Pipelines
// ────────────────────────────────────────────────────────────

/** Criar funil customizado + etapas padrão (permanente ou temporário) */
export function useCreateCustomPipeline() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      icon,
      color,
      // Temporal fields
      lifecycle_type = "permanent",
      starts_at,
      ends_at,
      team_goal,
      individual_goal,
      bonus_value,
      bonus_description,
      objective_pipe_type,
      objective_stage_key,
      template_type,
      lead_source_config,
      // Custom stages (overrides default)
      custom_stages,
    }: {
      name: string;
      description?: string;
      icon?: string;
      color?: string;
      lifecycle_type?: LifecycleType;
      starts_at?: string;
      ends_at?: string;
      team_goal?: number;
      individual_goal?: number;
      bonus_value?: number;
      bonus_description?: string;
      objective_pipe_type?: string;
      objective_stage_key?: string;
      template_type?: FunnelTemplateType;
      lead_source_config?: Record<string, unknown>;
      custom_stages?: Array<{ name: string; color: string; is_final_positive: boolean; is_final_negative: boolean }>;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      const slug = generateSlug(name);
      const isTemporary = lifecycle_type === "temporary";

      const stageDefs = custom_stages
        || (isTemporary && template_type ? TEMPORARY_FUNNEL_STAGES[template_type] : null)
        || DEFAULT_CUSTOM_STAGES;

      let pipelineId: string;
      try {
        pipelineId = await createCustomPipelineWithStages({
          organization_id: teamMember.organization_id,
          name,
          slug,
          description: description || null,
          icon: icon || (isTemporary ? "target" : "kanban"),
          color: color || (isTemporary ? "#8b5cf6" : "#3b82f6"),
          created_by: teamMember.profile_id,
          lifecycle_type,
          status: isTemporary ? "draft" : "active",
          starts_at: starts_at || null,
          ends_at: ends_at || null,
          team_goal: team_goal || null,
          individual_goal: individual_goal || null,
          bonus_value: bonus_value || null,
          bonus_description: bonus_description || null,
          objective_pipe_type: objective_pipe_type || null,
          objective_stage_key: objective_stage_key || null,
          template_type: template_type || null,
          lead_source_config: (lead_source_config || null) as Json,
        }, stageDefs.map((stage, index) => ({
          organization_id: teamMember.organization_id,
          stage_key: generateStageKey(stage.name),
          name: stage.name,
          color: stage.color,
          position: index,
          is_final_positive: stage.is_final_positive,
          is_final_negative: stage.is_final_negative,
        })));
      } catch (error) {
        if (
          typeof error === "object"
          && error !== null
          && ("code" in error && error.code === "23505"
            || "message" in error && String(error.message).includes("duplicate"))
        ) {
          throw new Error("Já existe um funil ativo com esse nome nesta organização");
        }
        throw error;
      }

      const { data: pipeline, error: pipeError } = await supabase
        .from("custom_pipelines")
        .select("*")
        .eq("id", pipelineId)
        .single();
      if (pipeError) throw pipeError;

      return pipeline as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

async function readCustomPipelineById(id: string): Promise<CustomPipeline> {
  const { data, error } = await supabase
    .from("custom_pipelines")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as CustomPipeline;
}

/** Ativar funil temporário (draft → active). */
export function useActivateTemporaryFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await updateCustomPipelineRecord(id, {
        status: "active",
        starts_at: new Date().toISOString(),
        _expected_lifecycle_type: "temporary",
      });
      return readCustomPipelineById(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Pausar funil temporário. */
export function usePauseTemporaryFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await updateCustomPipelineRecord(id, {
        status: "paused",
        _expected_lifecycle_type: "temporary",
      });
      return readCustomPipelineById(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Encerrar funil temporário. */
export function useEndTemporaryFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await updateCustomPipelineRecord(id, {
        status: "ended",
        _expected_lifecycle_type: "temporary",
      });
      return readCustomPipelineById(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Atualizar funil customizado. */
export function useUpdateCustomPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      position?: number;
    }) => {
      await updateCustomPipelineRecord(id, {
        ...updates,
        slug: updates.name ? generateSlug(updates.name) : undefined,
      });
      return readCustomPipelineById(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline"] });
    },
  });
}

/**
 * O que o hard delete vai destruir. Contagens medidas no banco, não estimadas.
 * `eventos_etapa` é o caderno de métricas do funil (ADR-0017) — ele NÃO volta.
 */
export interface CustomPipelineDeleteImpact {
  cards: number;
  leads: number;
  etapas: number;
  membros: number;
  eventos_etapa: number;
  vendas_orfas: number;
  negocios_orfaos: number;
  automacoes: number;
  disparos_em_voo: number;
  /**
   * Card de OUTRO funil parado numa etapa deste. `> 0` IMPEDE a exclusão, e o
   * botão fica desabilitado — não é aviso, é bloqueio.
   *
   * A FK `custom_pipe_entries.stage_id` não exige que a etapa pertença ao mesmo
   * funil da entry (3 casos medidos em prod, 25/08). Consertar sozinho não é
   * opção: repontuar dispara `stage_changed` e pode MANDAR MENSAGEM para um
   * lead que não tem nada a ver com este funil; apagar destrói card de um funil
   * que pode estar ativo.
   */
  cards_invasores: number;
}

/** Resultado do delete: o impacto medido + o que foi neutralizado junto. */
export interface CustomPipelineDeleteResult extends CustomPipelineDeleteImpact {
  automacoes_desativadas: number;
  disparos_neutralizados: number;
}

/**
 * Prévia do estrago, para o diálogo de confirmação. Só busca com o diálogo
 * aberto — é uma contagem cara e ninguém precisa dela antes de decidir.
 */
export function useCustomPipelineDeleteImpact(
  pipelineId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["custom_pipeline_delete_impact", pipelineId],
    queryFn: async () => {
      // SCRUM-626: caminho por id — pipeline_delete_impact é o motor único
      // (ramo custom devolve o MESMO shape do wrapper antigo).
      const { data, error } = await (supabase.rpc as any)(
        "pipeline_delete_impact",
        { p_pipeline_id: pipelineId },
      );
      if (error) throw error;
      return data as CustomPipelineDeleteImpact;
    },
    enabled: !!pipelineId && enabled,
    staleTime: 0,
  });
}

/**
 * Excluir funil customizado — HARD DELETE (era soft delete até 2026-08-25).
 *
 * Via RPC, não `.delete()`: são 4 statements que precisam cair juntos, dois
 * deles em tabelas (`workflows`, `blast_plans`) que o membro comum não
 * necessariamente pode atualizar, e `.delete()` sem `.select()` não distingue
 * "apagou" de "a RLS não casou com nada".
 */
export function useDeleteCustomPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // SCRUM-626: caminho por id — delete_pipeline é o motor único (para um
      // funil custom o comportamento é idêntico ao wrapper delete_custom_pipeline).
      const { data, error } = await (supabase.rpc as any)("delete_pipeline", {
        p_pipeline_id: id,
      });
      if (error) throw error;
      return data as CustomPipelineDeleteResult;
    },
    onSuccess: () => {
      // As 4 primeiras já existiam. As demais são as chaves que continuavam
      // servindo o funil excluído — a lista de Leads (`leads-deals`) e o painel
      // do Lead (`lead-pipes`) eram os dois vazamentos mais visíveis.
      [
        "custom_pipelines",
        "custom_pipeline",
        "custom_pipeline_stages",
        "custom_pipe_entries",
        "custom_pipe_stage_counts",
        "pipelines", // tabela-espelho — o trigger apagou a linha lá também
        "lead-pipes",
        "lead_all_pipelines",
        "leads-deals",
        "workflows",
        "blast_plans",
      ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
  });
}

// ────────────────────────────────────────────────────────────
// Mutations: Stages
// ────────────────────────────────────────────────────────────

/** Criar etapa em funil customizado */
export function useCreateCustomPipelineStage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      pipeline_id,
      name,
      color,
      // `position` segue no contrato (os chamadores mandam), mas NÃO é lida: o
      // número que a tela calcula ignora as etapas excluídas, que continuam
      // ocupando posição. Quem decide é `proximaPosicaoDeEtapa`, abaixo.
      is_final_positive,
      is_final_negative,
      stage_role,
    }: {
      pipeline_id: string;
      name: string;
      color?: string;
      position: number;
      is_final_positive?: boolean;
      is_final_negative?: boolean;
      /**
       * ADR-0017 §1 — papel semântico governado. Vindo do editor único de
       * etapas (SCRUM-636) é sempre escolha explícita do admin (won/lost
       * permitido — confirmação humana). Omitido, o INSTEAD OF da view aplica
       * o default 'open'.
       */
      stage_role?: import("@/contracts/pipe").StageRole;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      // A `position` que o editor manda vale como INTENÇÃO ("no fim da lista"),
      // não como endereço: ela é contada sobre as etapas VISÍVEIS, e etapa
      // excluída continua ocupando posição (soft delete). Quem decide o número
      // é o funil inteiro — ver `proximaPosicaoDeEtapa`.
      const posicaoLivre = await proximaPosicaoDeEtapa({ pipelineId: pipeline_id });

      let stageId: string;
      try {
        stageId = await createCustomPipelineStage({
          organization_id: teamMember.organization_id,
          pipeline_id,
          stage_key: generateStageKey(name),
          name,
          color: color || "#64748b",
          position: posicaoLivre,
          is_final_positive: is_final_positive || false,
          is_final_negative: is_final_negative || false,
          stage_role,
        });
      } catch (error) {
        const conflito = mensagemDeConflitoDeEtapa(error);
        if (conflito) throw new Error(conflito);
        throw error;
      }
      const { data, error } = await supabase
        .from("custom_pipeline_stages")
        .select("*")
        .eq("id", stageId)
        .single();

      if (error) throw error;
      return data as CustomPipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
      // Chaves unificadas por id (SCRUM-633/636) — a página /funil/:slug lê por elas.
      queryClient.invalidateQueries({ queryKey: ["funil-stages", variables.pipeline_id] });
    },
  });
}

/** Atualizar etapa */
export function useUpdateCustomPipelineStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      pipeline_id,
      ...updates
    }: {
      id: string;
      pipeline_id: string;
      name?: string;
      color?: string;
      position?: number;
      is_final_positive?: boolean;
      is_final_negative?: boolean;
      target_pipeline_id?: string | null;
      target_stage_id?: string | null;
      target_pipe_type?: string | null;
      target_stage_key?: string | null;
      checklist_template_id?: string | null;
      /** ADR-0017 §1 — só chega aqui por escolha explícita no editor único. */
      stage_role?: import("@/contracts/pipe").StageRole;
    }) => {
      await updateCustomPipelineStage(id, updates);
      const { data, error } = await supabase
        .from("custom_pipeline_stages")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as CustomPipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
      queryClient.invalidateQueries({ queryKey: ["funil-stages", variables.pipeline_id] });
    },
  });
}

/**
 * Compatibilidade do hook antigo. O editor novo usa `useDeletePipelineStage`,
 * que migra cards antes; este contrato continua fazendo somente soft delete.
 */
export function useDeleteCustomPipelineStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; pipeline_id: string }) => {
      await updateCustomPipelineStage(id, { is_active: false });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
    },
  });
}

/** Reordenar etapas */
export function useReorderCustomPipelineStages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeline_id,
      stages,
    }: {
      pipeline_id: string;
      stages: { id: string; position: number }[];
    }) => {
      // SCRUM-616: UNIQUE (pipeline_id, position) tornou o UPDATE por linha
      // inviável (cada request é uma transação; a permutação transita por
      // posições ocupadas). A RPC faz a permutação em statement único.
      const ordered = [...stages].sort((a, b) => a.position - b.position);
      const { error } = await supabase.rpc("reorder_pipeline_stages" as never, {
        p_stage_ids: ordered.map((s) => s.id),
      } as never);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
      queryClient.invalidateQueries({ queryKey: ["funil-stages", variables.pipeline_id] });
    },
  });
}

// ────────────────────────────────────────────────────────────
// Mutations: Entries (leads no funil)
// ────────────────────────────────────────────────────────────

/** Adicionar lead a funil customizado */
export function useAddLeadToCustomPipe() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      pipeline_id,
      lead_id,
      stage_id,
      assigned_to,
      notes,
    }: {
      pipeline_id: string;
      lead_id: string;
      stage_id: string;
      assigned_to?: string;
      notes?: string;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      let entryId: string;
      try {
        entryId = await createCustomPipelineEntry({
          organizationId: teamMember.organization_id,
          pipelineId: pipeline_id,
          leadId: lead_id,
          stageId: stage_id,
          assignedTo: assigned_to || null,
          notes: notes || null,
        });
      } catch (error) {
        if (
          typeof error === "object"
          && error !== null
          && "message" in error
          && String(error.message).includes("duplicate")
        ) {
          throw new Error("Este lead já está neste funil");
        }
        throw error;
      }
      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("*")
        .eq("id", entryId)
        .single();

      if (error) throw error;

      // Fire workflow triggers for lead entering custom pipeline
      if (data) {
        try {
          const { data: stageData } = await supabase
            .from("custom_pipeline_stages")
            .select("stage_key")
            .eq("id", data.stage_id)
            .maybeSingle();

          // stage_changed handled by PG trigger (trg_workflow_custom_pipe_stage_change)

          // Fire lead_created scoped to this custom pipeline
          triggerLeadCreatedInCustomPipeline({
            organizationId: data.organization_id,
            leadId: data.lead_id,
            pipelineId: data.pipeline_id,
          });
        } catch {
          // Non-blocking: workflow trigger failure shouldn't break the entry creation
        }
      }

      return data as CustomPipeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries", variables.pipeline_id] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_stage_counts", variables.pipeline_id] });
    },
  });
}

/** Funis de sistema alcançáveis pela auto-transição (slugs em `pipelines`). */
type SystemPipeSlug = "whatsapp" | "confirmacao" | "propostas";

/**
 * Teto de linhas lidas por `(funil de sistema, lead)` — espelha
 * `PIPELINE_ENTRY_READ_CAP` em `../model/usePipelineEntries.ts`.
 */
const SYSTEM_PIPE_ENTRY_READ_CAP = 50;

/**
 * O negócio CORRENTE do lead num funil de sistema, ou `null` se ele ainda não
 * está nele.
 *
 * Lê `pipeline_entries` em vez das views `pipe_*` porque `pipe_whatsapp` e
 * `pipe_confirmacao` não expõem `closed_at`, e sem ele não dá pra aplicar o
 * mesmo critério que o kanban e o Copilot já usam. O `pipelines!inner`
 * reproduz o JOIN da view; a escrita chama as funções compartilhadas, que
 * traduzem o vocabulário da UI para `pipeline_entries`.
 *
 * Corrente = ABERTO primeiro, depois o de movimentação mais recente — mesma
 * regra de `readActivePipelineEntry` (`../model/usePipelineEntries.ts`) e de
 * `pickActiveEntry` (`_shared/pipeline-adapter.ts`). Aqui errar tem preço
 * concreto: tirar um card da etapa de ganho dispara `fn_capture_sale_event`,
 * que grava estorno e não se desfaz.
 *
 * Por que não `.maybeSingle()`: com mais de uma linha o postgrest-js zera o
 * `data` e devolve `PGRST116`; o chamador lia isso como "não existe" e inseria
 * outro negócio a cada passagem. Depois do M1 (`20270730000050`, que derrubou
 * os três uniques do par funil+lead) N linhas é o caso normal — é assim que
 * recompra existe.
 *
 * Lança em falha de leitura: o `catch` da auto-transição pula a transição e
 * loga, em vez de inserir às cegas e duplicar o negócio.
 */
async function readCurrentSystemPipeEntry(slug: SystemPipeSlug, leadId: string) {
  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("id, closed_at, pipeline:pipelines!inner(slug)")
    .eq("lead_id", leadId)
    .eq("pipeline.slug", slug)
    .eq("pipeline.type", "system")
    .order("closed_at", { ascending: false, nullsFirst: true })
    .order("stage_changed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SYSTEM_PIPE_ENTRY_READ_CAP);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length > 1) {
    // Sinal explícito de "existem N" — o que `.maybeSingle()` apagava.
    console.warn(
      `[auto-transition] ${rows.length} negócios para lead=${leadId} no funil ${slug}; usando o primeiro ABERTO, ou o mais recente se todos estiverem fechados.`,
    );
  }
  return rows.find((r) => r.closed_at == null) ?? rows[0] ?? null;
}

/** Mover lead entre etapas (drag-and-drop) */
export function useMoveLeadInCustomPipe() {
  const queryClient = useQueryClient();
  const movePermission = useCanDo("move_pipe_record");

  return useMutation({
    mutationFn: async ({
      entry_id,
      pipeline_id,
      stage_id,
    }: {
      entry_id: string;
      pipeline_id: string;
      stage_id: string;
    }) => {
      if (!movePermission.allowed) {
        throw new Error(movePermission.isLoading
          ? "Permissões ainda carregando — tente novamente"
          : "Sem permissão para mover registros no pipe");
      }
      await updateCustomPipelineEntry(entry_id, {
        stage_id,
        stage_changed_at: new Date().toISOString(),
      });
      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("*")
        .eq("id", entry_id)
        .single();

      if (error) throw error;

      // Fetch stage data for workflow trigger and auto-transition
      const { data: stageRow } = await supabase
        .from("custom_pipeline_stages")
        .select("stage_key, is_final_positive, target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key")
        .eq("id", stage_id)
        .maybeSingle();

      // stage_changed handled by PG trigger (trg_workflow_custom_pipe_stage_change)

      // Auto-transition: check if target stage has a transition configured
      try {

      if (stageRow?.is_final_positive && data.lead_id && data.organization_id) {
        if (stageRow.target_pipeline_id && stageRow.target_stage_id) {
          // Transition to another custom pipeline (helper compartilhado)
          await upsertLeadIntoCustomPipe({
            leadId: data.lead_id,
            organizationId: data.organization_id,
            targetPipelineId: stageRow.target_pipeline_id,
            targetStageId: stageRow.target_stage_id,
          });
        } else if (stageRow.target_pipe_type && stageRow.target_stage_key) {
          // Transition to a standard pipeline
          const pipeType = stageRow.target_pipe_type;
          const targetStageKey = stageRow.target_stage_key;

          if (pipeType === "whatsapp") {
            // SCRUM-202: a transição escreve só a entry (via a view homônima). O
            // espelho `leads.pipe_whatsapp` sai daqui por dois motivos, e nenhum
            // é estilo:
            //
            //   1. era REDUNDANTE — quem alimenta a coluna é o gatilho
            //      `sync_pipeline_entry_to_lead_pipe_whatsapp`, que dispara no
            //      write da entry logo abaixo. Escrever dos dois lados só cria a
            //      chance de divergirem;
            //   2. era ESCRITA DIRETA em `leads` fora da porta do Negócio, e
            //      desde a `20270803000040` o espelho deixou de acompanhar o
            //      move — então este UPDATE podia deixar a coluna dizendo uma
            //      etapa que a entry não confirma.
            //
            // A coluna é dropada na fatia 3 (SCRUM-222); esta linha viraria erro
            // de coluna inexistente derrubando a transição inteira.
            const existing = await readCurrentSystemPipeEntry("whatsapp", data.lead_id);
            if (existing) {
              await updateSystemPipelineEntry(existing.id, { stage_key: targetStageKey });
            } else {
              await createSystemPipelineEntry({
                leadId: data.lead_id,
                organizationId: data.organization_id,
                slug: "whatsapp",
                stageKey: targetStageKey,
              });
            }
          } else if (pipeType === "confirmacao") {
            const existing = await readCurrentSystemPipeEntry("confirmacao", data.lead_id);
            if (existing) {
              await updateSystemPipelineEntry(existing.id, { stage_key: targetStageKey });
            } else {
              await createSystemPipelineEntry({
                leadId: data.lead_id,
                organizationId: data.organization_id,
                slug: "confirmacao",
                stageKey: targetStageKey,
              });
            }
          } else if (pipeType === "propostas") {
            const existing = await readCurrentSystemPipeEntry("propostas", data.lead_id);
            if (existing) {
              await updateSystemPipelineEntry(existing.id, { stage_key: targetStageKey });
            } else {
              await createSystemPipelineEntry({
                leadId: data.lead_id,
                organizationId: data.organization_id,
                slug: "propostas",
                stageKey: targetStageKey,
              });
            }
          } else if (pipeType === "upsell_base") {
            await supabase.from("upsell_clients").update({ tipo_cliente_tempo: targetStageKey }).eq("lead_id", data.lead_id);
          } else if (pipeType === "upsell_gestao") {
            await supabase.from("upsell_clients").update({ gestao_stage: targetStageKey }).eq("lead_id", data.lead_id);
          }
        }
      }
      } catch (transitionErr) {
        console.error("[auto-transition] Failed:", transitionErr);
      }

      return data as CustomPipeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries", variables.pipeline_id] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_stage_counts", variables.pipeline_id] });
      // Invalidate standard pipe queries for cross-pipe transitions
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** Remover lead de funil customizado */
export function useRemoveLeadFromCustomPipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entry_id, pipeline_id }: { entry_id: string; pipeline_id: string }) => {
      const { error } = await supabase
        .from("pipeline_entries")
        .delete()
        .eq("id", entry_id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries", variables.pipeline_id] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_stage_counts", variables.pipeline_id] });
    },
  });
}

// ────────────────────────────────────────────────────────────
// Helpers para Kanban
// ────────────────────────────────────────────────────────────

/** Converte etapas para formato de colunas do Kanban */
export function customStagesToColumns(stages: CustomPipelineStage[]) {
  return stages.map((stage) => ({
    id: stage.id,
    title: stage.name,
    color: stage.color || "#64748b",
  }));
}

/** Agrupa entries por stage_id para renderizar no Kanban */
export function groupEntriesByStage(
  entries: CustomPipeEntry[],
  stages: CustomPipelineStage[]
): Record<string, CustomPipeEntry[]> {
  const grouped: Record<string, CustomPipeEntry[]> = {};
  for (const stage of stages) {
    grouped[stage.id] = [];
  }
  for (const entry of entries) {
    if (grouped[entry.stage_id]) {
      grouped[entry.stage_id].push(entry);
    }
  }
  return grouped;
}
