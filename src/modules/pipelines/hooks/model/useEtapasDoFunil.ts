import { useMemo } from "react";
import { usePipelines } from "./usePipelines";
import { useAllPipelineStages } from "./usePipelineStages";
import { useCustomPipelineStages } from "../custom/useCustomPipelines";

/**
 * Etapas de UM funil, seja ele de sistema ou customizado (SCRUM-388).
 *
 * Existe porque as duas famílias guardam etapa em tabelas diferentes, com
 * chaves diferentes:
 *
 *   sistema  → `pipeline_stages`, achado por `pipeline_type` (= o slug do funil)
 *   custom   → `custom_pipeline_stages`, achado por `pipeline_id`
 *
 * Quem consome não deveria precisar saber disso. Antes desta função, quem
 * quisesse listar "as etapas deste funil" tinha que descobrir o tipo, escolher
 * o hook e traduzir a chave — três decisões repetidas em cada tela, e três
 * chances de a de custom ser esquecida (foi o que aconteceu com a conversão
 * entre etapas, que nasceu só com funil de sistema em mente).
 *
 * Devolve sempre `stage_key` + rótulo humano, que é o par que o motor de
 * métricas aceita como filtro (`from_stage_key` / `to_stage_key`).
 */

export interface EtapaDoFunil {
  /** O que vai no filtro do motor. */
  stageKey: string;
  /** Nome humano, para a tela. */
  label: string;
  position: number;
}

export function useEtapasDoFunil(pipelineId: string | null | undefined): {
  etapas: EtapaDoFunil[];
  isLoading: boolean;
} {
  const { data: pipelines = [], isLoading: carregandoFunis } = usePipelines();
  const funil = pipelines.find((p) => p.id === pipelineId);
  const ehCustom = !!funil && funil.type !== "system";

  const { data: stagesDeSistema = [], isLoading: carregandoSistema } = useAllPipelineStages();
  // O hook de custom já se desliga sozinho quando o id é undefined.
  const { data: stagesCustom = [], isLoading: carregandoCustom } = useCustomPipelineStages(
    ehCustom ? (pipelineId ?? undefined) : undefined,
  );

  const etapas = useMemo<EtapaDoFunil[]>(() => {
    if (!funil) return [];

    if (ehCustom) {
      return stagesCustom
        .map((s) => ({
          stageKey: s.stage_key,
          label: s.name || s.stage_key,
          position: s.position ?? 0,
        }))
        .sort((a, b) => a.position - b.position);
    }

    // Sistema: `pipeline_type` é o SLUG do funil, não o id. Confundir os dois
    // devolve lista vazia sem erro — a tela fica sem etapa e ninguém sabe por quê.
    return stagesDeSistema
      .filter((s) => s.pipeline_type === funil.slug && s.is_active !== false)
      .map((s) => ({
        stageKey: s.stage_key,
        label: s.name || s.stage_key,
        position: s.position ?? 0,
      }))
      .sort((a, b) => a.position - b.position);
  }, [funil, ehCustom, stagesCustom, stagesDeSistema]);

  return {
    etapas,
    isLoading: carregandoFunis || (ehCustom ? carregandoCustom : carregandoSistema),
  };
}
