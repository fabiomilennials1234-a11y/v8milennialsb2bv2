/**
 * Helpers puros do card de Funis (ContextPanelFunnels) — normalização dos funis
 * do lead + detecção de etapa terminal (ganho / perda) + rótulo por org.
 *
 * Fora do componente pra serem testáveis sem montar o painel. A fonte é
 * `useLeadAllPipelines` (standard + custom); os rótulos de funis de sistema vêm
 * de `usePipelineDisplayConfig` (customizável por org — grill 2026-07-27).
 */
import { etapaDoLeadEhDePerda, funisSemNegocioAberto, type PipelineStatus } from "@/modules/leads";

export interface FunnelStageView {
  key: string;
  /** Custom stages expose UUIDs; never write these into stage_key. */
  stageId?: string;
  label: string;
  role: string | null;
  /**
   * Etapa de perda (`isEtapaDePerda`: `lost` OU `is_final_negative`). Mover
   * para ela pede o motivo — inclusive em funil cuja etapa de perda só tem a
   * flag (Mustang/Riofix: `perdido_desqualificado`, role `open`).
   */
  isLoss: boolean;
}
export interface FunnelCardRow {
  /** Chave única de UI = o negócio (entryId): o lead pode ter N no mesmo funil. */
  key: string;
  /** pipeline_entries.id — alvo do move. */
  entryId: string;
  label: string;
  color: string;
  currentStageKey: string | null;
  stages: FunnelStageView[];
}

/**
 * Etapa terminal do ponto de vista do CLIQUE: ganho pede confirmação (registra
 * receita, ADR-0017); perda pede o MOTIVO (porta única, `useLossReasonGate`).
 * Não decide desfecho — só qual pergunta fazer antes do move (decisão B2d).
 */
export function terminalKind(stage: Pick<FunnelStageView, "role" | "isLoss"> | null | undefined): "won" | "lost" | null {
  if (!stage) return null;
  if (stage.isLoss) return "lost";
  if (stage.role === "won") return "won";
  return null;
}

interface DisplayConfigLike {
  pipe_type: string;
  display_name: string;
  is_visible?: boolean;
}

export interface AddableFunnel {
  /** pipeline_id (tabela pipelines) — alvo do insert em pipeline_entries. */
  pipelineId: string;
  label: string;
  color: string;
  /** primeira etapa do funil (destino do lead ao entrar). */
  firstStageKey: string;
  firstStageId?: string;
}

/**
 * Funis em que o lead não tem negócio ABERTO e que dá pra adicionar pelo chat:
 * precisa de pipeline_id resolvível (exclui upsell legacy) e ao menos uma
 * etapa. Negócio fechado (ganho/perdido) não tranca o funil — é a recompra.
 * Rótulo de sistema vem do display config; custom usa o nome próprio.
 */
export function availableFunnelsToAdd(
  pipelines: PipelineStatus[],
  displayConfig: DisplayConfigLike[] = [],
): AddableFunnel[] {
  const cfgByType = new Map(displayConfig.map((c) => [c.pipe_type, c]));
  const out: AddableFunnel[] = [];

  for (const p of funisSemNegocioAberto(pipelines)) {
    const firstStageKey = p.stages[0]?.id;
    if (!firstStageKey) continue;

    if (p.type === "standard") {
      if (!p.pipelineDbId) continue; // upsell legacy — não adicionável
      // SCRUM-637: `pipeType` já é o pipe_type do display config (slug real).
      const cfg = cfgByType.get(p.pipeType);
      if (cfg && cfg.is_visible === false) continue; // funil escondido pela org
      out.push({
        pipelineId: p.pipelineDbId,
        label: cfg?.display_name ?? p.label,
        color: p.color,
        firstStageKey,
      });
    } else {
      out.push({
        pipelineId: p.pipelineId,
        label: p.pipelineName,
        color: p.pipelineColor,
        firstStageKey,
        firstStageId: firstStageKey,
      });
    }
  }
  return out;
}

/**
 * Normaliza os pipelines do lead em linhas do card. Só funis onde o lead tem
 * entry (pipeId/entryId não-nulo). Rótulo de sistema vem do display config.
 */
export function toFunnelRows(
  pipelines: PipelineStatus[],
  displayConfig: DisplayConfigLike[] = [],
): FunnelCardRow[] {
  const labelByType = new Map(displayConfig.map((c) => [c.pipe_type, c.display_name]));
  const rows: FunnelCardRow[] = [];

  for (const p of pipelines) {
    if (p.type === "standard") {
      if (!p.pipeId) continue; // lead não está neste funil
      // Upsell/Carteira é tabela legacy própria (pipeId = upsell.id, NÃO
      // pipeline_entries.id) — mover via useMovePipelineEntry escreveria no id
      // errado. pipelineDbId null marca esses; fora do card.
      if (!p.pipelineDbId) continue;
      rows.push({
        key: p.pipeId,
        entryId: p.pipeId,
        label: labelByType.get(p.pipeType) ?? p.label,
        color: p.color,
        currentStageKey: p.currentStage,
        stages: p.stages.map((s) => ({
          key: s.id,
          label: s.label,
          role: s.role ?? null,
          isLoss: etapaDoLeadEhDePerda(s),
        })),
      });
    } else {
      if (!p.entryId) continue;
      rows.push({
        key: p.entryId,
        entryId: p.entryId,
        label: p.pipelineName,
        color: p.pipelineColor,
        currentStageKey: p.currentStageId,
        stages: p.stages.map((s) => ({
          key: s.id,
          stageId: s.id,
          label: s.name,
          role: s.role ?? null,
          isLoss: etapaDoLeadEhDePerda(s),
        })),
      });
    }
  }
  return rows;
}
