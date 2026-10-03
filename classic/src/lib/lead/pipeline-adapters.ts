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

/**
 * Id do NEGÓCIO representado por esta linha, ou `null` quando o lead não tem
 * negócio no funil.
 *
 * Existe porque `getPipelineKey` identifica o FUNIL, e depois do M1 o funil
 * deixou de ser identidade de linha: `useLeadAllPipelines` emite uma linha por
 * negócio, e um lead pode ter N no mesmo funil (recompra). Quem precisa de
 * chave estável de linha usa `${getPipelineKey(p)}:${getPipelineEntryId(p) ?? "none"}`.
 *
 * As duas metades da união guardam esse id com nomes diferentes — `pipeId` no
 * padrão, `entryId` no customizado —, que é a mesma distinção que
 * `isInPipeline` já fazia logo abaixo.
 */
export function getPipelineEntryId(p: PipelineStatus): string | null {
  return p.type === "standard" ? p.pipeId : p.entryId;
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
