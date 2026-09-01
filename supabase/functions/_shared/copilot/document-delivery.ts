/**
 * Verdade de ENTREGA de documento do Copilot.
 *
 * O problema que este módulo resolve: `pending_ai_actions` não tinha como
 * distinguir "o arquivo saiu no WhatsApp" de "o dedup suprimiu o envio". Os
 * dois caminhos gravavam `status='completed'`, porque `process-ai-actions`
 * decide o status só por `result.success` e `executeSendDocument` devolve
 * `success: true` quando suprime (send-document.ts, retornos `duplicate_document`
 * e `send_lock_held`).
 *
 * Isso criava um ciclo: a linha suprimida virava `completed`, o gate de dedup
 * lê exatamente as linhas `completed` daquela conversa, e passava a suprimir
 * todas as tentativas seguintes — para sempre. Medido em prod 2026-09-01:
 * 353 de 769 envios `completed` eram repetição, e numa amostra de 30 apenas
 * 3 tinham mensagem de mídia correspondente.
 *
 * A partir daqui, quem envia CARIMBA o desfecho no próprio payload da ação:
 *   - entregou  → `delivered_at` (+ `file_name` e o `document_id` canônico)
 *   - suprimiu  → `suppressed_at` + `suppressed_reason`
 *
 * Linha ANTIGA não tem carimbo nenhum. Ela é tratada como ENTREGUE
 * (`isDeliveredSend` devolve true), de propósito: sem carimbo não dá pra saber,
 * e assumir "não entregou" faria a IA reenviar material que o lead já recebeu
 * em conversas anteriores ao conserto. O conserto vale daqui pra frente.
 */

/** Carimbo gravado por quem entregou de fato o arquivo. */
export const DELIVERED_AT_KEY = "delivered_at";
/** Carimbo gravado quando um dos supressores barrou o envio. */
export const SUPPRESSED_AT_KEY = "suppressed_at";
/** Motivo da supressão (`duplicate_document`, `send_lock_held`, ...). */
export const SUPPRESSED_REASON_KEY = "suppressed_reason";

export type SendDocumentPayload = Record<string, unknown> | null | undefined;

/**
 * A ação representa um arquivo que REALMENTE chegou ao lead?
 *
 * true  → carimbada como entregue, OU antiga (sem carimbo — ver nota acima).
 * false → carimbada como suprimida: não entregou, e portanto não deve valer
 *         nem como prova de dedup nem como "já enviei" no prompt.
 */
export function isDeliveredSend(payload: SendDocumentPayload): boolean {
  if (!payload) return true; // sem payload = linha antiga; conservador
  if (payload[SUPPRESSED_AT_KEY]) return false;
  return true;
}

/** Nome do arquivo para exibir ao modelo; cai no id quando a linha é antiga. */
export function sentDocumentLabel(payload: SendDocumentPayload): string {
  const fileName = payload?.file_name;
  if (typeof fileName === "string" && fileName.length > 0) return fileName;
  const docId = payload?.document_id;
  if (typeof docId === "string" && docId.length > 0) return docId;
  return "unknown";
}
