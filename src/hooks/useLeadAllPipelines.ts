import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
import { useCustomPipelines } from "./useCustomPipelines";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────

export interface StandardPipelineStatus {
  type: "standard";
  pipeType: "qualificacao" | "confirmacao" | "propostas" | "upsell";
  label: string;
  color: string;
  pipeId: string | null;
  currentStage: string | null;
  currentStageLabel: string | null;
  stages: { id: string; label: string; color: string }[];
}

export interface CustomPipelineStatus {
  type: "custom";
  pipelineId: string;
  pipelineName: string;
  pipelineColor: string;
  pipelineIcon: string;
  entryId: string | null;
  currentStageId: string | null;
  currentStageName: string | null;
  stages: { id: string; name: string; color: string; position: number }[];
}

export type PipelineStatus = StandardPipelineStatus | CustomPipelineStatus;

// ─── Standard pipeline stage definitions ─────────────────────

const QUALIFICACAO_STAGES = [
  { id: "novo", label: "Novo", color: "#6366f1" },
  { id: "abordado", label: "Abordado", color: "#f59e0b" },
  { id: "respondeu", label: "Respondeu", color: "#3b82f6" },
  { id: "esfriou", label: "Esfriou", color: "#ef4444" },
  { id: "agendado", label: "Agendado", color: "#22c55e" },
];

const CONFIRMACAO_STAGES = [
  { id: "pre_confirmacao", label: "Pré-Confirmação", color: "#6366f1" },
  { id: "confirmado", label: "Confirmado", color: "#22c55e" },
  { id: "remarcado", label: "Remarcado", color: "#f59e0b" },
  { id: "cancelado", label: "Cancelado", color: "#ef4444" },
  { id: "realizada", label: "Realizada", color: "#10b981" },
];

const PROPOSTAS_STAGES = [
  { id: "proposta_enviada", label: "Proposta Enviada", color: "#6366f1" },
  { id: "em_negociacao", label: "Em Negociação", color: "#f59e0b" },
  { id: "fechado_ganho", label: "Fechado Ganho", color: "#22c55e" },
  { id: "fechado_perdido", label: "Fechado Perdido", color: "#ef4444" },
];

const UPSELL_STAGES = [
  { id: "ativo", label: "Ativo", color: "#22c55e" },
  { id: "em_expansao", label: "Em Expansão", color: "#3b82f6" },
  { id: "churn_risco", label: "Risco de Churn", color: "#f59e0b" },
  { id: "churned", label: "Churned", color: "#ef4444" },
];

// ─── Main hook: fetch lead status across all pipelines ────────

export function useLeadAllPipelines(leadId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const { data: customPipelines = [] } = useCustomPipelines();
  const orgId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["lead_all_pipelines", leadId, orgId, customPipelines.map((p) => p.id).join(",")],
    queryFn: async (): Promise<PipelineStatus[]> => {
      if (!leadId || !orgId) return [];

      // Fetch all standard pipelines + custom entries in parallel
      const [
        { data: pipeWhatsapp },
        { data: pipeConfirmacao },
        { data: pipePropostas },
        { data: pipeUpsell },
        { data: customEntries },
        { data: customStagesAll },
      ] = await Promise.all([
        supabase
          .from("pipe_whatsapp")
          .select("id, status")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .maybeSingle(),
        supabase
          .from("pipe_confirmacao")
          .select("id, status")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .maybeSingle(),
        supabase
          .from("pipe_propostas")
          .select("id, status")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .maybeSingle(),
        supabase
          .from("upsell")
          .select("id, status")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .maybeSingle(),
        supabase
          .from("custom_pipe_entries")
          .select("id, pipeline_id, stage_id")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId),
        supabase
          .from("custom_pipeline_stages")
          .select("id, pipeline_id, name, color, position")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("position", { ascending: true }),
      ]);

      const results: PipelineStatus[] = [];

      // Standard pipelines
      results.push({
        type: "standard",
        pipeType: "qualificacao",
        label: "Qualificação",
        color: "#6366f1",
        pipeId: pipeWhatsapp?.id || null,
        currentStage: pipeWhatsapp?.status || null,
        currentStageLabel: QUALIFICACAO_STAGES.find((s) => s.id === pipeWhatsapp?.status)?.label || null,
        stages: QUALIFICACAO_STAGES,
      });

      results.push({
        type: "standard",
        pipeType: "confirmacao",
        label: "Confirmação",
        color: "#22c55e",
        pipeId: pipeConfirmacao?.id || null,
        currentStage: pipeConfirmacao?.status || null,
        currentStageLabel: CONFIRMACAO_STAGES.find((s) => s.id === pipeConfirmacao?.status)?.label || null,
        stages: CONFIRMACAO_STAGES,
      });

      results.push({
        type: "standard",
        pipeType: "propostas",
        label: "Propostas",
        color: "#f59e0b",
        pipeId: pipePropostas?.id || null,
        currentStage: pipePropostas?.status || null,
        currentStageLabel: PROPOSTAS_STAGES.find((s) => s.id === pipePropostas?.status)?.label || null,
        stages: PROPOSTAS_STAGES,
      });

      results.push({
        type: "standard",
        pipeType: "upsell",
        label: "Carteira",
        color: "#3b82f6",
        pipeId: pipeUpsell?.id || null,
        currentStage: pipeUpsell?.status || null,
        currentStageLabel: UPSELL_STAGES.find((s) => s.id === pipeUpsell?.status)?.label || null,
        stages: UPSELL_STAGES,
      });

      // Custom pipelines
      const entriesMap = new Map((customEntries || []).map((e) => [e.pipeline_id, e]));
      const stagesByPipeline = new Map<string, typeof customStagesAll>();
      (customStagesAll || []).forEach((s) => {
        const arr = stagesByPipeline.get(s.pipeline_id) || [];
        arr.push(s);
        stagesByPipeline.set(s.pipeline_id, arr);
      });

      for (const pipeline of customPipelines) {
        const entry = entriesMap.get(pipeline.id);
        const stages = (stagesByPipeline.get(pipeline.id) || []).sort((a, b) => a.position - b.position);
        const currentStage = stages.find((s) => s.id === entry?.stage_id);

        results.push({
          type: "custom",
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          pipelineColor: pipeline.color,
          pipelineIcon: pipeline.icon,
          entryId: entry?.id || null,
          currentStageId: entry?.stage_id || null,
          currentStageName: currentStage?.name || null,
          stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, position: s.position })),
        });
      }

      return results;
    },
    enabled: !!leadId && !!orgId,
  });
}

// ─── Mutation: add lead to a standard pipeline ────────────────

export function useAddLeadToStandardPipe() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      leadId,
      pipeType,
      stageId,
    }: {
      leadId: string;
      pipeType: "qualificacao" | "confirmacao" | "propostas" | "upsell";
      stageId: string;
    }) => {
      if (!teamMember?.organization_id) throw new Error("Organização não encontrada");

      if (pipeType === "qualificacao") {
        const { error } = await supabase.from("pipe_whatsapp").insert({
          lead_id: leadId,
          status: stageId,
          responsible_id: teamMember.id,
          sdr_id: teamMember.id,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      } else if (pipeType === "confirmacao") {
        const { error } = await supabase.from("pipe_confirmacao").insert({
          lead_id: leadId,
          status: stageId,
          responsible_id: teamMember.id,
          sdr_id: teamMember.id,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      } else if (pipeType === "propostas") {
        const { error } = await supabase.from("pipe_propostas").insert({
          lead_id: leadId,
          status: stageId,
          responsible_id: teamMember.id,
          closer_id: teamMember.id,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      } else if (pipeType === "upsell") {
        const { error } = await supabase.from("upsell").insert({
          lead_id: leadId,
          status: stageId,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
    },
  });
}

// ─── Mutation: move lead in a standard pipeline ────────────────

export function useMoveLeadInStandardPipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeId,
      pipeType,
      newStageId,
    }: {
      pipeId: string;
      pipeType: "qualificacao" | "confirmacao" | "propostas" | "upsell";
      newStageId: string;
    }) => {
      const table =
        pipeType === "qualificacao" ? "pipe_whatsapp"
        : pipeType === "confirmacao" ? "pipe_confirmacao"
        : pipeType === "propostas" ? "pipe_propostas"
        : "upsell";

      const { error } = await supabase
        .from(table)
        .update({ status: newStageId })
        .eq("id", pipeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
    },
  });
}

// ─── Mutation: remove lead from a standard pipeline ────────────

export function useRemoveLeadFromStandardPipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeId,
      pipeType,
    }: {
      pipeId: string;
      pipeType: "qualificacao" | "confirmacao" | "propostas" | "upsell";
    }) => {
      const table =
        pipeType === "qualificacao" ? "pipe_whatsapp"
        : pipeType === "confirmacao" ? "pipe_confirmacao"
        : pipeType === "propostas" ? "pipe_propostas"
        : "upsell";

      const { error } = await supabase.from(table).delete().eq("id", pipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
    },
  });
}
