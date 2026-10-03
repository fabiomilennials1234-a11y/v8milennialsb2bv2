/**
 * O nome que a ORG usa para um funil de sistema — engagement.
 *
 * SCRUM-641 (Funil é Funil): rótulos de origem de follow-up/tarefa não podem
 * cravar "Confirmação"/"Propostas"/"WhatsApp" — são o seed congelado, e a org
 * chama os funis do jeito dela (`pipeline_display_config`). Linha ausente =
 * a org não tem mais o funil → fallback honesto.
 */
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";

export function useNomeDoPipe(): (pipeType: string) => string {
  const { data: displayConfigs } = usePipelineDisplayConfig();
  return (pipeType: string): string => {
    const c = displayConfigs?.find((x) => x.pipe_type === pipeType);
    return c ? c.display_name || NOME_DE_FABRICA[pipeType] || pipeType : "Funil removido";
  };
}
