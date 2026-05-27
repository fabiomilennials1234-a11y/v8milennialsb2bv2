/**
 * pipeline-adapters.ts — helpers puros para adaptar PipelineStatus para exibição.
 *
 * Extraído de src/components/chat/LeadDetailContent.tsx (Onda 3.1, C1).
 * Funções puras sem side effects — testáveis unitariamente.
 */

import type {
  PipelineStatus,
  StandardPipelineStatus,
  CustomPipelineStatus,
} from "@/modules/leads";

export interface NormalizedStage {
  id: string;
  name: string;
  color: string;
}

export function getPipelineKey(p: PipelineStatus): string {
  return p.type === "standard" ? p.pipeType : p.pipelineId;
}

export function getPipelineLabel(p: PipelineStatus): string {
  return p.type === "standard" ? p.label : p.pipelineName;
}

export function getPipelineColor(p: PipelineStatus): string {
  return p.type === "standard" ? p.color : p.pipelineColor;
}

export function isInPipeline(p: PipelineStatus): boolean {
  return p.type === "standard" ? !!p.pipeId : !!p.entryId;
}

export function getCurrentStageLabel(p: PipelineStatus): string | null {
  if (p.type === "standard") return p.currentStageLabel;
  return p.currentStageName;
}

export function getCurrentStageId(p: PipelineStatus): string | null {
  if (p.type === "standard") return p.currentStage;
  return p.currentStageId;
}

export function getNormalizedStages(p: PipelineStatus): NormalizedStage[] {
  if (p.type === "standard") {
    return p.stages.map((s) => ({ id: s.id, name: s.label, color: s.color }));
  }
  return p.stages.map((s) => ({ id: s.id, name: s.name, color: s.color }));
}
