/**
 * A etapa trata de reunião? (S6 — espelho da Agenda no funil)
 *
 * Regra separada do componente porque ela é DADO, não desenho: o card de
 * ações a consulta e o teste a prende sem montar React.
 *
 * UNIÃO, nunca substituição. Os quatro slugs do funil mergeado continuam
 * valendo — é o que garante que nenhuma org que hoje usa o merge perca um
 * botão que já tinha — e ganham como companhia o PAPEL governado da etapa
 * (`stage_role = 'meeting_booked'`, ADR-0017 §1) e o simples fato de HAVER
 * reunião marcada.
 *
 * Medido em prod (03/09): a etapa do caso concreto se chama "Reunião
 * Marcada", slug `reuniao_marcada`, `stage_role = 'open'` — nem o slug nem o
 * papel a alcançam. É por isso que a DATA no card do funil NÃO passa por esta
 * porta: ela é regida só pelo dado (`LeadCardData.date`). Aqui ficam só os
 * botões do funil mergeado.
 */
import type { StageRole } from "@/contracts/pipe";

/** Slugs de reunião do funil mergeado Oportunidades (ADR-0004). */
export const MEETING_STAGES = new Set(["agendado", "remarcar", "compareceu", "nao_compareceu"]);

export function ehEtapaDeReuniao(
  stageKey?: string | null,
  stageRole?: StageRole | null,
  meetingDate?: string | null,
): boolean {
  return (
    (!!stageKey && MEETING_STAGES.has(stageKey)) ||
    stageRole === "meeting_booked" ||
    meetingDate != null
  );
}
