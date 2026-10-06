/**
 * Funde um UPDATE do Realtime na linha que já está no cache.
 *
 * O Realtime NÃO manda a linha inteira num UPDATE. Coluna em TOAST que o UPDATE
 * não mudou (o `raw_payload` de ~2 kB num UPDATE de `status`) chega AUSENTE:
 *   - wal2json format-version 2 pula "unchanged TOAST Datum" (wal2json.c,
 *     "don't send unchanged TOAST Datum");
 *   - `realtime.apply_rls` tenta recuperá-la do registro antigo, que com
 *     REPLICA IDENTITY DEFAULT (whatsapp_messages em prod) só traz a PK.
 * Não há placeholder (`unchanged_toast`): a chave simplesmente não vem.
 *
 * Substituir a linha por `payload.new` apagava o `raw_payload` — e com ele o
 * menu, os botões e o pix da bolha — a cada mudança de status. Por isso:
 *   - chave ausente ou `undefined` → mantém o valor do cache;
 *   - `null` explícito → sobrescreve (é mudança real, ex.: `deleted_at`).
 *
 * As projeções `uazapi_*` vêm do SELECT (`raw_payload->...`, ver
 * whatsappMessagesQuery.ts) e têm PRECEDÊNCIA sobre `raw_payload` nos leitores
 * (uazapiMenuDisplay, uazapiButtonsDisplay, uazapiPixDisplay). O Realtime nunca
 * as manda. Quando o UPDATE traz um `raw_payload` novo, as projeções do cache
 * ficaram velhas: descartá-las deixa o leitor cair no `raw_payload` novo em vez
 * de mostrar o menu antigo.
 */
const PROJECAO_DO_RAW_PAYLOAD = /^uazapi_/;

export function mergeRealtimeUpdate<T extends object>(prev: T, incoming: Partial<T>): T {
  const merged = { ...prev };
  const rawPayloadNovo = (incoming as Record<string, unknown>).raw_payload !== undefined;
  if (rawPayloadNovo) {
    for (const key of Object.keys(merged)) {
      if (PROJECAO_DO_RAW_PAYLOAD.test(key)) delete (merged as Record<string, unknown>)[key];
    }
  }
  for (const key of Object.keys(incoming) as Array<keyof T>) {
    const value = incoming[key];
    if (value !== undefined) merged[key] = value as T[keyof T];
  }
  return merged;
}
