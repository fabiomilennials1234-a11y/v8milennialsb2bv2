import { isEtapaDePerda } from "./perda";

export interface StandardPipelineStatus {
  type: "standard";
  pipeType: "whatsapp" | "confirmacao" | "propostas" | "upsell";
  label: string;
  color: string;
  /** ID da tabela pipelines. Carteira legada tem ID nulo. */
  pipelineDbId: string | null;
  pipeId: string | null;
  /** Sem data de fechamento, o negócio conta como aberto. */
  closedAt?: string | null;
  currentStage: string | null;
  currentStageLabel: string | null;
  stages: { id: string; label: string; color: string; role?: string | null; isFinalNegative?: boolean }[];
}

export interface CustomPipelineStatus {
  type: "custom";
  pipelineId: string;
  pipelineName: string;
  pipelineColor: string;
  pipelineIcon: string;
  entryId: string | null;
  closedAt?: string | null;
  currentStageId: string | null;
  currentStageName: string | null;
  stages: { id: string; name: string; color: string; position: number; role?: string | null; isFinalNegative?: boolean }[];
}

export type PipelineStatus = StandardPipelineStatus | CustomPipelineStatus;

export function temNegocioAberto(pipeline: PipelineStatus): boolean {
  const entryId = pipeline.type === "custom" ? pipeline.entryId : pipeline.pipeId;
  return entryId !== null && pipeline.closedAt == null;
}

/** Os funis disponíveis para abrir um negócio. O histórico de negócios fechados permite recompra. */
export function funisSemNegocioAberto<T extends PipelineStatus>(pipelines: T[]): T[] {
  const funilDe = (pipeline: PipelineStatus) =>
    pipeline.type === "custom" ? pipeline.pipelineId : (pipeline.pipelineDbId ?? `sys:${pipeline.pipeType}`);
  const comAberto = new Set(pipelines.filter(temNegocioAberto).map(funilDe));
  const vistos = new Set<string>();
  const disponiveis: T[] = [];
  for (const pipeline of pipelines) {
    const funil = funilDe(pipeline);
    if (comAberto.has(funil) || vistos.has(funil)) continue;
    vistos.add(funil);
    disponiveis.push(pipeline);
  }
  return disponiveis;
}

export function etapaDoLeadEhDePerda(
  stage: { role?: string | null; isFinalNegative?: boolean } | null | undefined,
): boolean {
  return isEtapaDePerda(stage ? { stage_role: stage.role, is_final_negative: stage.isFinalNegative } : null);
}
