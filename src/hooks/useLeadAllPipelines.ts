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

// ─── Pipeline type mapping (pipeType alias → pipeline_stages.pipeline_type) ──
const PIPE_TYPE_MAP: Record<string, string> = {
  qualificacao: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
  upsell: "upsell_base",
};

// ─── Main hook: fetch lead status across all pipelines ────────

export function useLeadAllPipelines(leadId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const { data: customPipelines = [] } = useCustomPipelines();
  const orgId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["lead_all_pipelines", leadId, orgId, customPipelines.map((p) => p.id).join(",")],
    queryFn: async (): Promise<PipelineStatus[]> => {
      if (!leadId || !orgId) return [];

      // Fetch all standard pipelines + dynamic stages + custom entries in parallel
      const [
        { data: pipeWhatsapp },
        { data: pipeConfirmacao },
        { data: pipePropostas },
        { data: pipeUpsell },
        { data: dynamicStages },
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
          .from("pipeline_stages")
          .select("pipeline_type, stage_key, name, color, position")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("position", { ascending: true }),
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

      // Build dynamic stage lists keyed by pipeline_type
      const stagesByDbType = new Map<string, { id: string; label: string; color: string }[]>();
      (dynamicStages || []).forEach((s) => {
        const arr = stagesByDbType.get(s.pipeline_type) || [];
        arr.push({ id: s.stage_key, label: s.name, color: s.color || "#64748b" });
        stagesByDbType.set(s.pipeline_type, arr);
      });

      // Helper: get dynamic stages for a pipeType alias, with empty fallback
      const getStages = (pipeType: string) => stagesByDbType.get(PIPE_TYPE_MAP[pipeType] || pipeType) || [];

      const results: PipelineStatus[] = [];

      // Standard pipelines — stages come from pipeline_stages (dynamic)
      const buildStandard = (
        pipeType: "qualificacao" | "confirmacao" | "propostas" | "upsell",
        label: string,
        color: string,
        pipeEntry: { id: string; status: string } | null,
      ): StandardPipelineStatus => {
        const stages = getStages(pipeType);
        return {
          type: "standard",
          pipeType,
          label,
          color,
          pipeId: pipeEntry?.id || null,
          currentStage: pipeEntry?.status || null,
          currentStageLabel: stages.find((s) => s.id === pipeEntry?.status)?.label || null,
          stages,
        };
      };

      results.push(buildStandard("qualificacao", "Qualificação", "#6366f1", pipeWhatsapp));
      results.push(buildStandard("confirmacao", "Confirmação", "#22c55e", pipeConfirmacao));
      results.push(buildStandard("propostas", "Propostas", "#f59e0b", pipePropostas));
      results.push(buildStandard("upsell", "Carteira", "#3b82f6", pipeUpsell));

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
