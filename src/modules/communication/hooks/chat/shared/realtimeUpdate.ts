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
 */
export function mergeRealtimeUpdate<T extends object>(prev: T, incoming: Partial<T>): T {
  const merged = { ...prev };
  for (const key of Object.keys(incoming) as Array<keyof T>) {
    const value = incoming[key];
    if (value !== undefined) merged[key] = value as T[keyof T];
  }
  return merged;
}
