/**
 * Quais tipos de ação IA passam pelo guarda de concorrência por lead.
 *
 * `process-ai-actions` reagenda (+30s) uma ação quando `has_concurrent_ai_action`
 * acha uma irmã `processing` do mesmo lead e do mesmo tipo. Isso protege contra
 * corrida de ESCRITA — dois `update_pipeline_stage` disputando a etapa do mesmo
 * lead deixam o resultado dependente de quem grava por último.
 *
 * Envio de arquivo não tem essa corrida: dois arquivos pedidos no mesmo turno são
 * duas entregas independentes, e a garantia de no-máximo-uma-vez vem do lock
 * atômico em `_shared/actions/send-document.ts`, que é race-free.
 *
 * 🚨 Sujeitar `send_document` ao guarda tinha um efeito que ninguém veria pelas
 * métricas: `claim_pending_ai_actions` marca o LOTE INTEIRO como `processing`
 * antes do laço, então cada mídia via a irmã do próprio lote e voltava para
 * `pending`. Saía **uma mídia por lead por ciclo de cron** (1×/min), e como o
 * claim ordena por `created_at ASC` a ação mais VELHA era sempre a preterida —
 * starvation enquanto o lead recebesse mídia nova, não jitter. `retry_count` não
 * incrementa nesse caminho e o status final é `completed`: o atraso é invisível.
 *
 * Medido na Forever Bella em 2026-09-02: `send_document` com mediana de 123,5s,
 * média 196,9s e máximo de 512s (8min32), contra 41,5s de `update_pipeline_stage`.
 * O texto "vou te enviar a foto" sai na hora e a foto cai minutos depois, quando
 * o assunto já é outro.
 */
export const CONCURRENCY_GUARD_EXEMPT_ACTIONS = new Set(["send_document"]);

export function needsConcurrencyGuard(actionType: string): boolean {
  return !CONCURRENCY_GUARD_EXEMPT_ACTIONS.has(actionType);
}
