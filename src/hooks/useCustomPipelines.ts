import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { triggerStageChangedWorkflows, triggerLeadCreatedInCustomPipeline } from "@/lib/workflowTrigger";
import { useCanPerformActionAsync } from "@/lib/permissions";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type LifecycleType = "permanent" | "temporary";
export type FunnelStatus = "draft" | "active" | "paused" | "ended";
export type FunnelTemplateType = "indicacao" | "prospeccao" | "reativacao";

export interface CustomPipeline {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  color: string;
  position: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Temporal fields
  lifecycle_type: LifecycleType;
  starts_at: string | null;
  ends_at: string | null;
  status: FunnelStatus;
  team_goal: number | null;
  individual_goal: number | null;
  bonus_value: number | null;
  bonus_description: string | null;
  objective_pipe_type: string | null;
  objective_stage_key: string | null;
  template_type: FunnelTemplateType | null;
  lead_source_config: Record<string, unknown> | null;
}

export interface CustomPipelineStage {
  id: string;
  organization_id: string;
  pipeline_id: string;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  is_active: boolean;
  is_final_positive: boolean;
  is_final_negative: boolean;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  target_pipe_type: string | null;
  target_stage_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomPipeEntry {
  id: string;
  organization_id: string;
  pipeline_id: string;
  lead_id: string;
  stage_id: string;
  assigned_to: string | null;
  notes: string | null;
  entered_at: string;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  // Joins
  lead?: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
  };
  stage?: CustomPipelineStage;
  assigned_profile?: { id: string; full_name: string | null; avatar_url: string | null };
}

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
  return useQuery({
    queryKey: ["custom_pipe_entries", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("custom_pipe_entries")
        .select(`
          *,
          lead:leads(id, name, company, phone, email),
          stage:custom_pipeline_stages(id, name, color, stage_key, position),
          assigned_profile:profiles!custom_pipe_entries_assigned_to_fkey(id, full_name, avatar_url)
        `)
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as CustomPipeEntry[];
    },
    enabled: !!pipelineId,
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

      // 1. Criar pipeline
      const { data: pipeline, error: pipeError } = await supabase
        .from("custom_pipelines")
        .insert({
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
          lead_source_config: lead_source_config || null,
        })
        .select()
        .single();

      if (pipeError) {
        if (pipeError.code === "23505" || pipeError.message?.includes("duplicate")) {
          throw new Error("Já existe um funil ativo com esse nome nesta organização");
        }
        throw pipeError;
      }

      // 2. Criar etapas — do template ou padrão
      const stageDefs = custom_stages
        || (isTemporary && template_type ? TEMPORARY_FUNNEL_STAGES[template_type] : null)
        || DEFAULT_CUSTOM_STAGES;

      const stageInserts = stageDefs.map((stage, index) => ({
        organization_id: teamMember.organization_id,
        pipeline_id: pipeline.id,
        stage_key: generateStageKey(stage.name),
        name: stage.name,
        color: stage.color,
        position: index,
        is_final_positive: stage.is_final_positive,
        is_final_negative: stage.is_final_negative,
      }));

      const { error: stagesError } = await supabase
        .from("custom_pipeline_stages")
        .insert(stageInserts);

      if (stagesError) {
        await supabase.from("custom_pipelines").delete().eq("id", pipeline.id);
        throw stagesError;
      }

      return pipeline as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Ativar funil temporário (draft → active) */
export function useActivateTemporaryFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("custom_pipelines")
        .update({
          status: "active",
          starts_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("lifecycle_type", "temporary")
        .select()
        .single();

      if (error) throw error;
      return data as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Pausar funil temporário */
export function usePauseTemporaryFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("custom_pipelines")
        .update({ status: "paused" })
        .eq("id", id)
        .eq("lifecycle_type", "temporary")
        .select()
        .single();

      if (error) throw error;
      return data as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Encerrar funil temporário */
export function useEndTemporaryFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("custom_pipelines")
        .update({ status: "ended" })
        .eq("id", id)
        .eq("lifecycle_type", "temporary")
        .select()
        .single();

      if (error) throw error;
      return data as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
    },
  });
}

/** Atualizar funil customizado */
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
      const updateData: Record<string, unknown> = { ...updates };
      if (updates.name) {
        updateData.slug = generateSlug(updates.name);
      }

      const { data, error } = await supabase
        .from("custom_pipelines")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        if (error.code === "23505" || error.message?.includes("duplicate")) {
          throw new Error("Já existe um funil ativo com esse nome nesta organização");
        }
        throw error;
      }
      return data as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline"] });
    },
  });
}

/** Desativar funil customizado (soft delete) */
export function useDeleteCustomPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("custom_pipelines")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
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
      position,
      is_final_positive,
      is_final_negative,
    }: {
      pipeline_id: string;
      name: string;
      color?: string;
      position: number;
      is_final_positive?: boolean;
      is_final_negative?: boolean;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      const { data, error } = await supabase
        .from("custom_pipeline_stages")
        .insert({
          organization_id: teamMember.organization_id,
          pipeline_id,
          stage_key: generateStageKey(name),
          name,
          color: color || "#64748b",
          position,
          is_final_positive: is_final_positive || false,
          is_final_negative: is_final_negative || false,
        })
        .select()
        .single();

      if (error) {
        if (error.message?.includes("duplicate")) {
          throw new Error("Já existe uma etapa com esse nome neste funil");
        }
        throw error;
      }
      return data as CustomPipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
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
    }) => {
      const { data, error } = await supabase
        .from("custom_pipeline_stages")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CustomPipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
    },
  });
}

/** Desativar etapa */
export function useDeleteCustomPipelineStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, pipeline_id }: { id: string; pipeline_id: string }) => {
      const { error } = await supabase
        .from("custom_pipeline_stages")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
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
      const updates = stages.map((stage) =>
        supabase
          .from("custom_pipeline_stages")
          .update({ position: stage.position })
          .eq("id", stage.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) throw errors[0].error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipeline_id] });
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

      const { data, error } = await supabase
        .from("custom_pipe_entries")
        .insert({
          organization_id: teamMember.organization_id,
          pipeline_id,
          lead_id,
          stage_id,
          assigned_to: assigned_to || null,
          notes: notes || null,
        })
        .select()
        .single();

      if (error) {
        if (error.message?.includes("duplicate")) {
          throw new Error("Este lead já está neste funil");
        }
        throw error;
      }

      // Fire workflow triggers for lead entering custom pipeline
      if (data) {
        try {
          const { data: stageData } = await supabase
            .from("custom_pipeline_stages")
            .select("stage_key")
            .eq("id", data.stage_id)
            .maybeSingle();

          // Fire stage_changed so workflows triggered on pipeline entry work
          triggerStageChangedWorkflows({
            organizationId: data.organization_id,
            leadId: data.lead_id,
            pipelineId: data.pipeline_id,
            toStage: stageData?.stage_key || data.stage_id,
          });

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
    },
  });
}

/** Mover lead entre etapas (drag-and-drop) */
export function useMoveLeadInCustomPipe() {
  const queryClient = useQueryClient();
  const { data: movePermission } = useCanPerformActionAsync("move_pipe_record");

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
      if (movePermission && !movePermission.allowed) {
        throw new Error("Sem permissão para mover registros no pipe");
      }
      const { data, error } = await supabase
        .from("custom_pipe_entries")
        .update({
          stage_id,
          stage_changed_at: new Date().toISOString(),
        })
        .eq("id", entry_id)
        .select()
        .single();

      if (error) throw error;

      // Fetch stage data for workflow trigger and auto-transition
      const { data: stageRow } = await supabase
        .from("custom_pipeline_stages")
        .select("stage_key, is_final_positive, target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key")
        .eq("id", stage_id)
        .maybeSingle();

      // Trigger workflow automations for custom pipe stage change
      // Use stage_key (not UUID) to match trigger_config.stages saved by TriggerPanel
      if (data.lead_id && data.organization_id) {
        triggerStageChangedWorkflows({
          organizationId: data.organization_id,
          leadId: data.lead_id,
          pipelineId: pipeline_id,
          toStage: stageRow?.stage_key || stage_id,
        });
      }

      // Auto-transition: check if target stage has a transition configured
      try {

      if (stageRow?.is_final_positive && data.lead_id && data.organization_id) {
        if (stageRow.target_pipeline_id && stageRow.target_stage_id) {
          // Transition to another custom pipeline
          const { data: existingEntry } = await supabase
            .from("custom_pipe_entries")
            .select("id")
            .eq("lead_id", data.lead_id)
            .eq("pipeline_id", stageRow.target_pipeline_id)
            .maybeSingle();

          if (existingEntry) {
            await supabase
              .from("custom_pipe_entries")
              .update({ stage_id: stageRow.target_stage_id, stage_changed_at: new Date().toISOString() })
              .eq("id", existingEntry.id);
          } else {
            await supabase.from("custom_pipe_entries").insert({
              lead_id: data.lead_id,
              organization_id: data.organization_id,
              pipeline_id: stageRow.target_pipeline_id,
              stage_id: stageRow.target_stage_id,
              entered_at: new Date().toISOString(),
              stage_changed_at: new Date().toISOString(),
            });
          }
        } else if (stageRow.target_pipe_type && stageRow.target_stage_key) {
          // Transition to a standard pipeline
          const pipeType = stageRow.target_pipe_type;
          const targetStageKey = stageRow.target_stage_key;

          if (pipeType === "whatsapp") {
            await supabase.from("leads").update({ pipe_whatsapp: targetStageKey }).eq("id", data.lead_id);
            const { data: existing } = await supabase
              .from("pipe_whatsapp").select("id").eq("lead_id", data.lead_id).maybeSingle();
            if (existing) {
              await supabase.from("pipe_whatsapp").update({ status: targetStageKey }).eq("id", existing.id);
            } else {
              await supabase.from("pipe_whatsapp").insert({
                lead_id: data.lead_id, organization_id: data.organization_id, status: targetStageKey,
              });
            }
          } else if (pipeType === "confirmacao") {
            const { data: existing } = await supabase
              .from("pipe_confirmacao").select("id").eq("lead_id", data.lead_id).maybeSingle();
            if (existing) {
              await supabase.from("pipe_confirmacao").update({ status: targetStageKey }).eq("id", existing.id);
            } else {
              await supabase.from("pipe_confirmacao").insert({
                lead_id: data.lead_id, organization_id: data.organization_id, status: targetStageKey,
              });
            }
          } else if (pipeType === "propostas") {
            const { data: existing } = await supabase
              .from("pipe_propostas").select("id").eq("lead_id", data.lead_id).maybeSingle();
            if (existing) {
              await supabase.from("pipe_propostas").update({ status: targetStageKey }).eq("id", existing.id);
            } else {
              await supabase.from("pipe_propostas").insert({
                lead_id: data.lead_id, organization_id: data.organization_id, status: targetStageKey,
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
      // Invalidate standard pipe queries for cross-pipe transitions
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
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
        .from("custom_pipe_entries")
        .delete()
        .eq("id", entry_id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries", variables.pipeline_id] });
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
