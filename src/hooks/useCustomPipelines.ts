import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { triggerStageChangedWorkflows } from "@/lib/workflowTrigger";
import { useCanPerformActionAsync } from "@/lib/permissions";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

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
    company_name: string | null;
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

// Etapas padrão para novos funis
const DEFAULT_CUSTOM_STAGES = [
  { name: "Novo", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
  { name: "Em andamento", color: "#eab308", is_final_positive: false, is_final_negative: false },
  { name: "Concluído", color: "#22c55e", is_final_positive: true, is_final_negative: false },
];

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
          lead:leads(id, name, company_name, phone, email),
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

/** Criar funil customizado + etapas padrão */
export function useCreateCustomPipeline() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      icon,
      color,
    }: {
      name: string;
      description?: string;
      icon?: string;
      color?: string;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      const slug = generateSlug(name);

      // 1. Criar pipeline
      const { data: pipeline, error: pipeError } = await supabase
        .from("custom_pipelines")
        .insert({
          organization_id: teamMember.organization_id,
          name,
          slug,
          description: description || null,
          icon: icon || "kanban",
          color: color || "#3b82f6",
          created_by: teamMember.profile_id,
        })
        .select()
        .single();

      if (pipeError) {
        if (pipeError.message?.includes("duplicate")) {
          throw new Error("Já existe um funil com esse nome");
        }
        throw pipeError;
      }

      // 2. Criar etapas padrão
      const stageInserts = DEFAULT_CUSTOM_STAGES.map((stage, index) => ({
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
        // Rollback: excluir pipeline se etapas falharam
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

      if (error) throw error;
      return data as CustomPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline"] });
    },
  });
}

/** Desativar funil customizado */
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

      // Trigger visual workflow automations for custom pipe stage change
      if (data.lead_id && data.organization_id) {
        triggerStageChangedWorkflows({
          organizationId: data.organization_id,
          leadId: data.lead_id,
          pipelineId: pipeline_id,
          toStage: stage_id,
        });
      }

      return data as CustomPipeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries", variables.pipeline_id] });
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
