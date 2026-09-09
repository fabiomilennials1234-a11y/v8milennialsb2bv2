import { useMemo } from "react";
import type { StageRole } from "@/contracts/pipe";
import { useFunilStages } from "./usePaginatedFunil";

/**
 * Etapa de QUALQUER funil, resolvida por `pipeline_id` — shape MÍNIMO.
 *
 * SCRUM-637 (convergência dos gêmeos 632×633): este hook deixou de ter query
 * própria — é um SELECTOR sobre `useFunilStages`, a query única de etapas por
 * funil (`["funil-stages", pipelineId]`). Antes eram duas queries idênticas em
 * chaves diferentes (`stages_do_funil` × `funil-stages`), com invalidation e
 * staleTime divergindo por construção.
 *
 *   - `id`        → alvo canônico de escrita (`bulk_add_to_pipeline.p_stage_id`)
 *   - `stage_key` → chave das RPCs de leitura (`get_pipeline_page.p_stage_id`,
 *                   contagens por `stage_key`)
 *   - `stage_role`→ semântica won/lost/open (métricas de conversão)
 */
export interface StageDoFunil {
  id: string;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  stage_role: StageRole;
  is_final_positive: boolean;
  is_final_negative: boolean;
}

/**
 * Lista as etapas ATIVAS de um funil (sistema OU custom) por `pipeline_id`,
 * direto de `pipeline_stages` — sem descobrir tipo, sem escolher hook por
 * família, sem traduzir chave. Etapas com `pipeline_id` NULL (resíduo de funil
 * deletado) ficam de fora por construção: o predicado é a própria FK.
 */
export function useStagesDoFunil(pipelineId: string | null | undefined) {
  const query = useFunilStages(pipelineId ?? undefined);

  const data = useMemo<StageDoFunil[] | undefined>(() => {
    if (!query.data) return undefined;
    return query.data.map((s) => ({
      id: s.id,
      stage_key: s.stage_key,
      name: s.name ?? s.stage_key,
      color: s.color,
      position: s.position ?? 0,
      stage_role: (s.stage_role ?? "open") as StageRole,
      is_final_positive: s.is_final_positive ?? false,
      is_final_negative: s.is_final_negative ?? false,
    }));
  }, [query.data]);

  return { ...query, data };
}
