import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/modules/identity";
import { usePipeOps } from "../pipe-ops";

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

const PIPE_TYPE_MAP: Record<string, string> = {
  qualificacao: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
  upsell: "upsell_base",
};

const SYSTEM_SLUG_TO_PIPE: Record<string, "qualificacao" | "confirmacao" | "propostas"> = {
  whatsapp: "qualificacao",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

// ─── Main hook: unified pipeline_entries query ────────

export function useLeadAllPipelines(leadId: string | null) {
  const { useCustomPipelines } = usePipeOps();
  const { data: teamMember } = useCurrentTeamMember();
  const { data: customPipelines = [] } = useCustomPipelines();
  const orgId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["lead_all_pipelines", leadId, orgId, customPipelines.map((p) => p.id).join(",")],
    queryFn: async (): Promise<PipelineStatus[]> => {
      if (!leadId || !orgId) return [];

      const [
        { data: allEntries },
        { data: dynamicStages },
        { data: allPipelines },
        { data: customStagesAll },
        { data: pipeUpsell },
      ] = await Promise.all([
        (supabase.from as any)("pipeline_entries")
          .select("id, pipeline_id, stage_key")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId),
        supabase
          .from("pipeline_stages")
          .select("pipeline_type, stage_key, name, color, position")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("position", { ascending: true }),
        (supabase.from as any)("pipelines")
          .select("id, slug, type, name, color, icon")
          .eq("organization_id", orgId)
          .eq("is_active", true),
        supabase
          .from("custom_pipeline_stages")
          .select("id, pipeline_id, name, color, position, stage_key")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("position", { ascending: true }),
        // Upsell still lives in its own table (no sync trigger yet)
        supabase
          .from("upsell")
          .select("id, status")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);

      const entries = allEntries ?? [];
      const pipelines = (allPipelines ?? []) as { id: string; slug: string; type: string; name: string; color: string; icon: string }[];

      // Build stage lookup
      const stagesByDbType = new Map<string, { id: string; label: string; color: string }[]>();
      (dynamicStages || []).forEach((s) => {
        const arr = stagesByDbType.get(s.pipeline_type) || [];
        arr.push({ id: s.stage_key, label: s.name, color: s.color || "#64748b" });
        stagesByDbType.set(s.pipeline_type, arr);
      });

      const getStages = (pipeType: string) => stagesByDbType.get(PIPE_TYPE_MAP[pipeType] || pipeType) || [];

      // Map pipeline_id → entry
      const entryByPipelineId = new Map(entries.map((e: any) => [e.pipeline_id, e]));

      // Map pipeline slug → pipeline
      const pipelineBySlug = new Map(pipelines.map((p) => [p.slug, p]));

      const results: PipelineStatus[] = [];

      // System pipelines
      for (const [slug, pipeType] of Object.entries(SYSTEM_SLUG_TO_PIPE)) {
        const pipeline = pipelineBySlug.get(slug);
        const entry = pipeline ? entryByPipelineId.get(pipeline.id) : null;
        const stages = getStages(pipeType);
        const label = slug === "whatsapp" ? "Qualificação" : slug === "confirmacao" ? "Confirmação" : "Propostas";
        const color = slug === "whatsapp" ? "#6366f1" : slug === "confirmacao" ? "#22c55e" : "#f59e0b";

        results.push({
          type: "standard",
          pipeType,
          label,
          color,
          pipeId: entry?.id || null,
          currentStage: entry?.stage_key || null,
          currentStageLabel: stages.find((s) => s.id === entry?.stage_key)?.label || null,
          stages,
        });
      }

      // Upsell (still legacy — no sync trigger yet)
      results.push({
        type: "standard",
        pipeType: "upsell",
        label: "Carteira",
        color: "#3b82f6",
        pipeId: pipeUpsell?.id || null,
        currentStage: pipeUpsell?.status || null,
        currentStageLabel: getStages("upsell").find((s) => s.id === pipeUpsell?.status)?.label || null,
        stages: getStages("upsell"),
      });

      // Custom pipelines
      const stagesByPipeline = new Map<string, typeof customStagesAll>();
      (customStagesAll || []).forEach((s) => {
        const arr = stagesByPipeline.get(s.pipeline_id) || [];
        arr.push(s);
        stagesByPipeline.set(s.pipeline_id, arr);
      });

      for (const pipeline of customPipelines) {
        const entry = entryByPipelineId.get(pipeline.id);
        const stages = (stagesByPipeline.get(pipeline.id) || []).sort((a, b) => a.position - b.position);
        const currentStage = entry ? stages.find((s) => s.stage_key === entry.stage_key || s.id === entry.stage_key) : null;

        results.push({
          type: "custom",
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          pipelineColor: pipeline.color,
          pipelineIcon: pipeline.icon,
          entryId: entry?.id || null,
          currentStageId: currentStage?.id || null,
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
// Writes to legacy tables → sync triggers push to pipeline_entries

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

      // Virtual master team_members carry a non-UUID id ("master-virtual-<uuid>")
      // and must never be written into uuid FK columns (responsible_id/sdr_id/closer_id).
      const memberId = isVirtualTeamMember(teamMember.id) ? null : teamMember.id;

      if (pipeType === "qualificacao") {
        const { error } = await supabase.from("pipe_whatsapp").insert({
          lead_id: leadId,
          status: stageId,
          responsible_id: memberId,
          sdr_id: memberId,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      } else if (pipeType === "confirmacao") {
        const { error } = await supabase.from("pipe_confirmacao").insert({
          lead_id: leadId,
          status: stageId,
          responsible_id: memberId,
          sdr_id: memberId,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      } else if (pipeType === "propostas") {
        const { error } = await supabase.from("pipe_propostas").insert({
          lead_id: leadId,
          status: stageId,
          responsible_id: memberId,
          closer_id: memberId,
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
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
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
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
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
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
    },
  });
}
