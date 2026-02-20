import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";

export type PipelineType = "whatsapp" | "confirmacao" | "propostas";

export interface PipelineStage {
  id: string;
  organization_id: string;
  pipeline_type: PipelineType;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  is_active: boolean;
  is_final_positive: boolean;
  is_final_negative: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageInsert {
  pipeline_type: PipelineType;
  stage_key: string;
  name: string;
  color?: string;
  position: number;
  is_final_positive?: boolean;
  is_final_negative?: boolean;
}

// Controle para garantir que etapas padrão existam no banco (uma vez por sessão)
const defaultsEnsuredForSession = new Set<string>();

// Etapas padrão com flags de etapa final (fallback + seed no banco)
interface DefaultStage {
  id: string;
  title: string;
  color: string;
  is_final_positive?: boolean;
  is_final_negative?: boolean;
}

export const DEFAULT_STAGES: Record<PipelineType, DefaultStage[]> = {
  whatsapp: [
    { id: "novo", title: "Novo", color: "#6366f1" },
    { id: "abordado", title: "Abordado", color: "#f59e0b" },
    { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
    { id: "esfriou", title: "Esfriou", color: "#ef4444" },
    { id: "agendado", title: "Agendado ✓", color: "#22c55e", is_final_positive: true },
  ],
  confirmacao: [
    { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
    { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
    { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
    { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
    { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
    { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
    { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
    { id: "compareceu", title: "Compareceu ✓", color: "#22c55e", is_final_positive: true },
    { id: "perdido", title: "Perdido ✗", color: "#ef4444", is_final_negative: true },
  ],
  propostas: [
    { id: "marcar_compromisso", title: "Marcar Compromisso", color: "#F5C518" },
    { id: "reativar", title: "Reativar", color: "#F97316" },
    { id: "compromisso_marcado", title: "Compromisso Marcado", color: "#3B82F6" },
    { id: "esfriou", title: "Esfriou", color: "#64748B" },
    { id: "futuro", title: "Futuro", color: "#8B5CF6" },
    { id: "vendido", title: "Vendido ✓", color: "#22C55E", is_final_positive: true },
    { id: "perdido", title: "Perdido", color: "#EF4444", is_final_negative: true },
  ],
};

/**
 * Garante que as etapas padrão de TODOS os pipelines existam no banco para uma organização.
 * Usa upsert com ignoreDuplicates (ON CONFLICT DO NOTHING), então é idempotente e segura.
 */
async function ensureDefaultStagesInDb(organizationId: string) {
  const allStages: Record<string, unknown>[] = [];

  for (const pipeType of ["whatsapp", "confirmacao", "propostas"] as PipelineType[]) {
    for (let i = 0; i < DEFAULT_STAGES[pipeType].length; i++) {
      const stage = DEFAULT_STAGES[pipeType][i];
      allStages.push({
        organization_id: organizationId,
        pipeline_type: pipeType,
        stage_key: stage.id,
        name: stage.title,
        color: stage.color,
        position: i,
        is_active: true,
        is_final_positive: stage.is_final_positive ?? false,
        is_final_negative: stage.is_final_negative ?? false,
      });
    }
  }

  const { error } = await supabase
    .from("pipeline_stages")
    .upsert(allStages, {
      onConflict: "organization_id,pipeline_type,stage_key",
      ignoreDuplicates: true,
    });

  if (error) {
    console.warn("Error ensuring default stages via upsert:", error.message);
  }
}

/**
 * Hook para buscar etapas de um pipeline específico
 */
export function usePipelineStages(pipelineType: PipelineType) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  useRealtimeSubscription("pipeline_stages", ["pipeline_stages", pipelineType]);

  return useQuery({
    queryKey: ["pipeline_stages", pipelineType, organizationId],
    queryFn: async () => {
      if (!organizationId) {
        // Retornar etapas padrão se não houver organização
        return DEFAULT_STAGES[pipelineType].map((stage, index) => ({
          id: stage.id,
          stage_key: stage.id,
          name: stage.title,
          color: stage.color,
          position: index,
          is_active: true,
          is_final_positive: false,
          is_final_negative: false,
        }));
      }

      const fallbackStages = DEFAULT_STAGES[pipelineType].map((stage, index) => ({
        id: stage.id,
        stage_key: stage.id,
        name: stage.title,
        color: stage.color,
        position: index,
        is_active: true,
        is_final_positive: false,
        is_final_negative: false,
      }));

      try {
        // Garantir que etapas padrão existam no banco (uma vez por sessão).
        // Resolve o cenário onde a organização não tem etapas padrão criadas,
        // fazendo o sistema depender de um fallback em memória que não é persistido.
        // Usa upsert direto com ignoreDuplicates (ON CONFLICT DO NOTHING).
        const ensureKey = `${organizationId}`;
        if (!defaultsEnsuredForSession.has(ensureKey)) {
          defaultsEnsuredForSession.add(ensureKey);
          await ensureDefaultStagesInDb(organizationId);
        }

        const { data, error } = await supabase
          .from("pipeline_stages")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("pipeline_type", pipelineType)
          .eq("is_active", true)
          .order("position", { ascending: true });

        // Se houver erro (tabela não existe, etc), usa fallback
        if (error) {
          console.warn("Pipeline stages table not available, using defaults:", error.message);
          return fallbackStages;
        }

        // Se não houver etapas (mesmo após ensure), usar fallback
        if (!data || data.length === 0) {
          return fallbackStages;
        }

        return data as PipelineStage[];
      } catch (err) {
        // Fallback em caso de qualquer erro
        console.warn("Error fetching pipeline stages, using defaults:", err);
        return fallbackStages;
      }
    },
    enabled: true,
  });
}

/**
 * Hook para buscar todas as etapas de todos os pipelines (para admin)
 */
export function useAllPipelineStages() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["all_pipeline_stages", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("organization_id", organizationId)
        .order("pipeline_type")
        .order("position", { ascending: true });

      if (error) throw error;
      return data as PipelineStage[];
    },
    enabled: !!organizationId,
  });
}

/**
 * Converte etapas do banco para o formato usado nos componentes de Kanban
 */
export function stagesToColumns(stages: PipelineStage[] | { id: string; stage_key: string; name: string; color: string | null }[]) {
  return stages.map((stage) => ({
    id: "stage_key" in stage ? stage.stage_key : stage.id,
    title: stage.name,
    color: stage.color || "#64748b",
  }));
}

/**
 * Hook para criar uma nova etapa
 */
export function useCreatePipelineStage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (stage: PipelineStageInsert) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      // Garantir que etapas padrão existam no banco antes de criar nova etapa.
      // Isso previne o bug onde criar uma etapa fazia as padrão (fallback) sumirem,
      // pois o fallback só é ativado quando não há nenhuma etapa no banco.
      await ensureDefaultStagesInDb(teamMember.organization_id);

      const { data, error } = await supabase
        .from("pipeline_stages")
        .insert({
          ...stage,
          organization_id: teamMember.organization_id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}

/**
 * Hook para atualizar uma etapa
 */
export function useUpdatePipelineStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      pipeline_type,
      ...updates
    }: {
      id: string;
      pipeline_type: PipelineType;
      name?: string;
      color?: string;
      position?: number;
      is_active?: boolean;
      is_final_positive?: boolean;
      is_final_negative?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as PipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}

/**
 * Hook para deletar/desativar uma etapa
 */
export function useDeletePipelineStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, pipeline_type }: { id: string; pipeline_type: PipelineType }) => {
      // Ao invés de deletar, desativamos a etapa para preservar dados históricos
      const { error } = await supabase
        .from("pipeline_stages")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}

/**
 * Hook para reordenar etapas
 */
export function useReorderPipelineStages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeline_type,
      stages,
    }: {
      pipeline_type: PipelineType;
      stages: { id: string; position: number }[];
    }) => {
      const updates = stages.map((stage) =>
        supabase
          .from("pipeline_stages")
          .update({ position: stage.position, updated_at: new Date().toISOString() })
          .eq("id", stage.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);

      if (errors.length > 0) {
        throw errors[0].error;
      }

      return true;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}

/**
 * Retorna o nome amigável do tipo de pipeline
 */
export function getPipelineTypeName(type: PipelineType): string {
  const names: Record<PipelineType, string> = {
    whatsapp: "Qualificação",
    confirmacao: "Confirmação",
    propostas: "Propostas",
  };
  return names[type];
}

/**
 * Converte etapas do banco para o formato {value, label} usado nos selects/checkboxes.
 * Substitui as constantes hardcoded PIPE_STAGES, PIPE_CONFIRMACAO_STAGES, etc.
 */
export function stagesToSelectOptions(
  stages: PipelineStage[] | { id: string; stage_key: string; name: string; color: string | null }[] | undefined
): { value: string; label: string }[] {
  if (!stages) return [];
  return stages.map((s) => ({
    value: "stage_key" in s ? s.stage_key : s.id,
    label: s.name,
  }));
}

/**
 * Hook que retorna etapas dinâmicas formatadas para selects/checkboxes.
 * Substituição direta de PIPE_STAGES[pipelineType].
 */
export function usePipelineStageOptions(pipelineType: PipelineType) {
  const { data: stages, isLoading } = usePipelineStages(pipelineType);
  const options = stagesToSelectOptions(stages);
  return { options, isLoading, stages };
}

/**
 * Hook que retorna etapas de TODOS os pipes formatadas para selects.
 * Substituição direta de PIPE_STAGES (objeto completo).
 */
export function useAllPipelineStageOptions() {
  const whatsapp = usePipelineStageOptions("whatsapp");
  const confirmacao = usePipelineStageOptions("confirmacao");
  const propostas = usePipelineStageOptions("propostas");

  const isLoading = whatsapp.isLoading || confirmacao.isLoading || propostas.isLoading;

  const stagesByPipe: Record<string, { value: string; label: string }[]> = {
    whatsapp: whatsapp.options,
    confirmacao: confirmacao.options,
    propostas: propostas.options,
  };

  return { stagesByPipe, isLoading };
}
