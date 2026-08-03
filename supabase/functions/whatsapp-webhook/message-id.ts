/**
 * Casamento de `message_id` entre o evento `messages` (que grava) e o evento
 * `messages_update` (que atualiza status/edição/reação).
 *
 * ── O bug que isto conserta ────────────────────────────────────────────────
 * O INSERT grava o id COMPOSTO que a Uazapi manda no evento `messages`
 * (`<owner>:<ID>`, ex. `558587240008:A5297FB32FA1D95D9379C6A56735EC81`), mas o
 * evento `messages_update` traz o ID NU em `event.MessageIDs[]`
 * (`A5297FB32FA1D95D9379C6A56735EC81`). O handler casava pelo nu → ZERO linhas.
 *
 * Como o PostgREST não trata "0 linhas afetadas" como erro, o `try/catch` nunca
 * disparava e o handler seguia gravando `runtime_log status='success'`.
 * Medido em 28/07/2026 no prod: 84k eventos `messages_update` "com sucesso" em
 * 3 dias, e **nenhuma** das 1.955.029 mensagens (57 orgs, desde 24/01) jamais
 * chegou a `delivered` ou `read`. O tique duplo azul do chat era decorativo.
 *
 * Mantido em módulo próprio (sem imports remotos) para ser exercitado por teste
 * — o `index.ts` importa `https://esm.sh/...` e não roda no vitest.
 */

/**
 * Uazapi ReadReceipt `Type` / status → `whatsapp_messages.status`.
 *
 * O CHECK `whatsapp_messages_status_check` só aceita
 * pending/sent/delivered/read/received/failed. `Played` (áudio ouvido) NÃO
 * existe lá e viraria 23514 **em silêncio** (o UPDATE não usa `throwOnError`),
 * então mapeia para `read`. Valor fora do mapa é ignorado, nunca gravado cru.
 */
export const RECEIPT_STATUS_MAP: Record<string, string> = {
  delivered: "delivered",
  read: "read",
  played: "read",
  sent: "sent",
  pending: "pending",
  failed: "failed",
  error: "failed",
};

/** Traduz o `Type` do receipt para um status válido, ou `undefined`. */
export function mapReceiptStatus(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return RECEIPT_STATUS_MAP[raw.toLowerCase()];
}

/**
 * Candidatos de `message_id` para casar uma mensagem já gravada, para uso com
 * `.in("message_id", ...)`. Cobre o payload novo (id nu) e um eventual payload
 * que já venha composto.
 *
 * O prefixo vem de `whatsapp_instances.phone_number`, que bate em 100% das
 * linhas (32.637/32.637 medidas em 24h de prod); `raw_payload->>'owner'` é
 * fallback porque falta em ~1% dos casos.
 */
export function buildMessageIdCandidates(
  rawId: string,
  instancePhoneNumber: string | null | undefined,
  owner?: unknown,
): string[] {
  const ids = new Set<string>([rawId]);
  const colon = rawId.indexOf(":");
  if (colon >= 0) {
    const bare = rawId.slice(colon + 1);
    if (bare.length > 0) ids.add(bare);
  } else {
    const prefix =
      instancePhoneNumber ?? (typeof owner === "string" ? owner : null);
    if (prefix) ids.add(`${prefix}:${rawId}`);
  }
  return [...ids];
}

/**
 * Extrai a lista de ids crus de um payload de `messages_update`.
 * `MessageIDs` é ARRAY — um único receipt pode cobrir várias mensagens, e o
 * handler antigo só olhava `[0]`.
 */
export function extractRawMessageIds(data: {
  ids?: unknown;
  id?: unknown;
  messageid?: unknown;
  key?: { id?: unknown };
}): string[] {
  const source =
    Array.isArray(data.ids) && data.ids.length > 0
      ? data.ids
      : [data.id ?? data.messageid ?? data.key?.id];
  return source.filter(
    (v: unknown): v is string => typeof v === "string" && v.length > 0,
  );
}
