/**
 * Contracts — merge do funil Agendamentos dentro de Oportunidades (ADR-0004).
 *
 * Função PURA (zero side-effect, zero React/Supabase). Anexa o ciclo de vida
 * da reunião ao funil de Oportunidades (whatsapp) de uma org SEM tocar nas
 * etapas de qualificação que a org já tem — algumas orgs customizaram as suas.
 *
 * A migration SQL e o seed (`ensureDefaultStagesInDb`) espelham esta regra.
 */
import type { DefaultStage } from "./pipe-defaults";

/** Etapas de desfecho da reunião anexadas ao funil de Oportunidades. */
export const MEETING_STAGES: DefaultStage[] = [
  { id: "agendado", title: "Agendado", color: "#6366f1" },
  { id: "remarcar", title: "Remarcar", color: "#f97316" },
  { id: "compareceu", title: "Compareceu", color: "#22c55e", is_final_positive: true },
  // SEM `is_final_negative`. Faltar não encerra o negócio — e a flag não era
  // só rótulo: `PipeWhatsapp` deriva o destino do "Marcar perdido" com
  // `stages.find(s => s.is_final_negative)` sobre a lista ordenada por
  // posição, e a etapa de FALTA vem antes da de PERDA. O botão "Perdido" do
  // card mandava o lead para a etapa onde ele já estava — gravava o motivo e
  // não saía do lugar. Medido em prod nas duas orgs que tinham a marcação.
  { id: "nao_compareceu", title: "Não compareceu", color: "#ef4444" },
];

/**
 * Devolve as etapas existentes (intocadas) + as etapas de reunião que faltam,
 * anexadas no fim na ordem canônica.
 */
export function appendMeetingStages(existing: DefaultStage[]): DefaultStage[] {
  // `agendado` deixa de ser terminal positivo + handoff — `compareceu` é o novo
  // terminal. Normaliza um `agendado` pré-existente sem mexer no resto.
  const normalized = existing.map((stage) => {
    if (stage.id !== "agendado") return stage;
    const { is_final_positive, target_pipe_type, target_stage_key, ...rest } = stage;
    return rest;
  });

  const existingIds = new Set(normalized.map((s) => s.id));
  const toAppend = MEETING_STAGES.filter((s) => !existingIds.has(s.id));
  return [...normalized, ...toAppend];
}
