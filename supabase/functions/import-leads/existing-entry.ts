/**
 * Card que o lead JÁ tem no funil de destino, na importação de planilha.
 *
 * Incidente Calçados SCORE (18/11): uma lista com telefones que já estavam no
 * funil Mustang - Propostas foi subida sem coluna "Etapa". Para cada duplicado
 * o import chamou `upsertPipeEntryDetailed`, que SOBRESCREVE etapa, responsável,
 * notas e metadata do card existente. 26 leads em Esperando Resposta, Proposta
 * Enviada etc. voltaram para Novo Lead e perderam o responsável.
 *
 * Regra: planilha NÃO desfaz trabalho já feito. Num card existente o import só
 * escreve o que a linha diz de forma explícita:
 *  - etapa: só se a linha trouxe a coluna Etapa (e difere da atual);
 *  - responsável / notas: só se a linha trouxe valor (nunca nulo por cima);
 *  - metadata: só as chaves com valor (nunca null por cima).
 * Card que não existe segue o caminho de criação de sempre.
 */

export interface ExistingEntryInput {
  /** Texto cru da coluna Etapa da linha (vazio = a planilha não pediu etapa). */
  rowStage: string | null | undefined;
  /** Etapa resolvida a partir da linha (ou o padrão do funil quando vazia). */
  resolvedStageKey: string;
  /** Etapa em que o card está agora. */
  currentStageKey: string;
  assignedTo: string | null | undefined;
  notes: string | null | undefined;
  metadata: Record<string, unknown>;
}

export interface ExistingEntryUpdates {
  stageKey?: string;
  assignedTo?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function buildExistingEntryUpdates(input: ExistingEntryInput): ExistingEntryUpdates {
  const updates: ExistingEntryUpdates = {};

  const explicitStage = (input.rowStage ?? "").trim() !== "";
  if (explicitStage && input.resolvedStageKey !== input.currentStageKey) {
    updates.stageKey = input.resolvedStageKey;
  }

  if (input.assignedTo) updates.assignedTo = input.assignedTo;
  if (input.notes && input.notes.trim() !== "") updates.notes = input.notes;

  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.metadata)) {
    if (value !== null && value !== undefined) metadata[key] = value;
  }
  if (Object.keys(metadata).length > 0) updates.metadata = metadata;

  return updates;
}
