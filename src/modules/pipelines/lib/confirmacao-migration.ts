/**
 * Regras PURAS da migração Agendamentos → Oportunidades (ADR-0004, Slice 6).
 *
 * Encodam o mapeamento de stages legados e a resolução de colisão cross-pipe.
 * A migration SQL espelha estas regras; estes testes são a spec canônica.
 */
import type { ConfirmationStatus } from "./confirmation-button";

export interface MappedStage {
  /** Stage destino no funil whatsapp; null quando é perda (org decide o final_negative). */
  stageKey: string | null;
  confirmationStatus: ConfirmationStatus;
  /** true = marcar perdido (rotear pro stage is_final_negative da org). */
  lost: boolean;
}

const REMINDER_STAGES = new Set([
  "reuniao_marcada",
  "confirmar_d5",
  "confirmar_d3",
  "confirmar_d2",
  "confirmar_d1",
  "confirmacao_no_dia",
]);

export function mapConfirmacaoStage(oldStageKey: string, isConfirmed: boolean): MappedStage {
  const confirmationStatus: ConfirmationStatus = isConfirmed ? "confirmado" : "pendente";

  if (REMINDER_STAGES.has(oldStageKey)) {
    return { stageKey: "agendado", confirmationStatus, lost: false };
  }
  if (oldStageKey === "remarcar") {
    return { stageKey: "remarcar", confirmationStatus: "pendente", lost: false };
  }
  if (oldStageKey === "compareceu") {
    return { stageKey: "compareceu", confirmationStatus, lost: false };
  }
  if (oldStageKey === "perdido") {
    return { stageKey: null, confirmationStatus: "pendente", lost: true };
  }
  // Stage desconhecido (org customizou): aterrissa em agendado, preserva confirmação.
  return { stageKey: "agendado", confirmationStatus, lost: false };
}

export interface PipeEntryLite {
  id: string;
  stageKey: string;
  metadata: Record<string, unknown>;
}

export interface DedupResult {
  /** Row que permanece como entry do funil whatsapp. */
  survivingId: string;
  /** Row a deletar pra evitar colisão UNIQUE(lead_id, pipeline_id); null se não há. */
  dropId: string | null;
  /** Metadata fundido pra aplicar no row sobrevivente. */
  metadata: Record<string, unknown>;
}

/**
 * Resolve a colisão de um lead presente em whatsapp E confirmacao.
 * Confirmacao "vence" (mais avançado): seus dados prevalecem. Quando ambos
 * existem, mantém o row de whatsapp (evita repoint) mas aplica os dados de
 * confirmacao e dropa o row de confirmacao.
 */
export function resolveDedup(
  whatsapp: PipeEntryLite | null,
  confirmacao: PipeEntryLite | null,
): DedupResult {
  if (whatsapp && confirmacao) {
    return {
      survivingId: whatsapp.id,
      dropId: confirmacao.id,
      metadata: { ...whatsapp.metadata, ...confirmacao.metadata },
    };
  }
  if (confirmacao) {
    return { survivingId: confirmacao.id, dropId: null, metadata: confirmacao.metadata };
  }
  if (whatsapp) {
    return { survivingId: whatsapp.id, dropId: null, metadata: whatsapp.metadata };
  }
  throw new Error("resolveDedup: nenhuma entry fornecida");
}
