import { useMemo } from "react";
import { useStagesDoFunil } from "./useStagesDoFunil";

/**
 * Fachada de etapas de um funil. Fonte única: `pipeline_stages` por
 * `pipeline_id`, para qualquer funil. `stageKey` permanece para filtros
 * legados; novas configurações persistem `id`.
 */

export interface EtapaDoFunil {
  /** Referência canônica para novas escritas. */
  id: string;
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
  const { data: stages = [], isLoading } = useStagesDoFunil(pipelineId);

  const etapas = useMemo<EtapaDoFunil[]>(() => {
    return stages
      .map((s) => ({
        id: s.id,
        stageKey: s.stage_key,
        label: s.name || s.stage_key,
        position: s.position ?? 0,
      }))
      .sort((a, b) => a.position - b.position);
  }, [stages]);

  return {
    etapas,
    isLoading,
  };
}
