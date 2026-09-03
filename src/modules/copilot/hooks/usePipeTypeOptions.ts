/**
 * Opções de funil para as telas do Copilot — com o nome que a ORG usa.
 *
 * SCRUM-641 (Funil é Funil): substitui os labels cravados de `PIPE_TYPES`
 * ("Pipe Confirmação"/"Pipe Propostas"/"Pipe WhatsApp"), que apareciam
 * independente de como a org chama seus funis — e ofereciam funil que a org
 * podia nem ter. A lista vem de `pipeline_display_config` via
 * `destinosDeSistema` (mesma regra de nome do resto do app).
 *
 * "Campanhas" continua estática: campanha não é funil, é o paralelo deles.
 * Valor salvo que não está mais na lista degrada para o slug cru nos chips
 * (`.find(...)?.label || valor`) — mesmo padrão do resíduo upsell_* (D9).
 */
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { destinosDeSistema } from "@/contracts/pipe";

export interface PipeTypeOption {
  value: string;
  label: string;
}

export function usePipeTypeOptions(
  opts: { incluirCampanha?: boolean } = {},
): PipeTypeOption[] {
  const { incluirCampanha = true } = opts;
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const sistema = destinosDeSistema(displayConfigs).map((d) => ({
    value: d.pipeType,
    label: d.label,
  }));
  return incluirCampanha
    ? [...sistema, { value: "campanha", label: "Campanhas" }]
    : sistema;
}
