/**
 * quoted-text — extrai o TEXTO de uma mensagem citada (reply) do payload do
 * webhook, tolerando as várias formas que os provedores mandam.
 *
 * Extraído de index.ts pra ser testável (index.ts tem Deno.serve no topo).
 *
 * Correção 2026-07-27: alguns provedores (ex.: instância da Carol) mandam
 * `data.quoted` como STRING que é o **id da mensagem citada** (ex.:
 * "3EB0CEDD31B834C6863D67"), não o texto. O código antigo tratava essa string
 * como texto e o chat mostrava `[Em resposta a: "3EB0..."]` — id cru, inútil
 * pro cliente. Agora um id não é confundido com texto.
 */

/** Um id de mensagem do WhatsApp: hex maiúsculo/minúsculo, ≥15 chars, sem espaços. */
export function looksLikeMessageId(s: string): boolean {
  return /^[0-9A-Fa-f]{15,}$/.test(s.trim());
}

export function extractQuotedText(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  const ctx =
    data.contextInfo ??
    data.message?.contextInfo ??
    data.message?.extendedTextMessage?.contextInfo ??
    data.message?.imageMessage?.contextInfo ??
    data.message?.videoMessage?.contextInfo ??
    data.quoted?.contextInfo ??
    null;

  const q =
    ctx?.quotedMessage ??
    data.quotedMessage ??
    data.quotedMsg ??
    (data.quoted && typeof data.quoted === "object" ? data.quoted : null) ??
    null;

  // Some provider versions flatten the quoted text straight onto the payload.
  if (!q) {
    const flat =
      data.quotedText ??
      (typeof data.quoted === "string" ? data.quoted : null) ??
      null;
    // Um `data.quoted` string que é só o id da mensagem citada NÃO é texto —
    // não folda pra não mostrar id cru no chat.
    if (typeof flat === "string" && flat.trim() && !looksLikeMessageId(flat)) {
      return flat.trim();
    }
    return null;
  }

  const text =
    q.conversation ??
    q.text ??
    q.extendedTextMessage?.text ??
    q.imageMessage?.caption ??
    q.videoMessage?.caption ??
    q.documentMessage?.caption ??
    q.caption ??
    null;

  if (typeof text === "string" && text.trim()) return text.trim();

  // Quoted a media message with no caption — surface a typed placeholder so the
  // copilot knows the lead referenced something rather than nothing at all.
  if (q.imageMessage) return "[imagem]";
  if (q.videoMessage) return "[vídeo]";
  if (q.audioMessage || q.pttMessage) return "[áudio]";
  if (q.documentMessage) return "[documento]";
  if (q.stickerMessage) return "[figurinha]";
  if (q.locationMessage) return "[localização]";

  return null;
}

// ============================================================================
// Id da mensagem citada + snapshot `reply_context`
// ============================================================================

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * O `contextInfo` do payload, em qualquer das formas que a Uazapi/Baileys
 * mandam. Em `content.contextInfo` mora o do reply de botão (ver
 * interactive-reply.test.ts) e o de mídia/texto estendido.
 */
function contextInfoOf(data: any): any {
  return (
    data.contextInfo ??
    data.content?.contextInfo ??
    data.message?.contextInfo ??
    data.message?.extendedTextMessage?.contextInfo ??
    data.message?.imageMessage?.contextInfo ??
    data.message?.videoMessage?.contextInfo ??
    data.quoted?.contextInfo ??
    null
  );
}

/**
 * Id (provedor) da mensagem que o cliente CITOU, ou null.
 *
 * Fontes, da mais confiável para a menos: `contextInfo.stanzaID` (WhatsApp),
 * `data.quoted` string que parece id (fixture torquesdr-live-shapes), e as
 * formas planas `quotedMessageId`/`replyid`. Um `data.quoted` string que NÃO
 * parece id é o TEXTO citado (ver extractQuotedText) e não vira id.
 */
export function extractQuotedMessageId(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const ctx = contextInfoOf(data);
  const fromCtx = nonEmptyString(ctx?.stanzaID) ?? nonEmptyString(ctx?.stanzaId);
  if (fromCtx) return fromCtx;
  if (typeof data.quoted === "string" && looksLikeMessageId(data.quoted)) return data.quoted.trim();
  if (data.quoted && typeof data.quoted === "object") {
    const nested = nonEmptyString(data.quoted.id) ?? nonEmptyString(data.quoted.messageId);
    if (nested) return nested;
  }
  return nonEmptyString(data.quotedMessageId) ?? nonEmptyString(data.quotedId) ?? nonEmptyString(data.replyid);
}

/**
 * Texto da citada para o SNAPSHOT (não para o `content`): além do que
 * extractQuotedText já lê, olha `content.contextInfo` (onde a Uazapi põe o
 * contexto do reply). Separado de propósito: ampliar extractQuotedText
 * mudaria o prefixo `[Em resposta a:` que a IA e a busca já consomem.
 */
export function extractQuotedSnapshotText(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  return extractQuotedText(data) ??
    (data.content?.contextInfo ? extractQuotedText({ contextInfo: data.content.contextInfo }) : null);
}

/** Quem escreveu a citada, quando o payload diz (`contextInfo.participant`). */
export function extractQuotedParticipant(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const ctx = contextInfoOf(data);
  return nonEmptyString(ctx?.participant) ?? nonEmptyString(data.quotedParticipant);
}

export interface ReplyContextSnapshot {
  messageId: string;
  text: string;
  direction: "incoming" | "outgoing";
}

const MEDIA_LABEL: Record<string, string> = {
  image: "Imagem", audio: "Áudio", ptt: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha",
};

/** Remove o prefixo `[Em resposta a: "..."]` que o webhook dobra em `content`. */
export function stripQuotedPrefix(content: string): string {
  const m = content.match(/^\[Em resposta a: ["“”][\s\S]*?["“”]\](?:\n|$)/);
  return m ? content.slice(m[0].length) : content;
}

export interface QuotedOriginalRow {
  message_id: string;
  content: string | null;
  message_type: string | null;
  direction: string | null;
}

/**
 * Monta o snapshot que o chat desenha. Com a original gravada, usa o texto dela
 * (sem o prefixo de uma citação anterior); sem ela, o texto vindo do payload.
 * Devolve null quando não há o que mostrar nem id para ancorar.
 */
export function buildReplyContext(args: {
  quotedId: string | null;
  payloadText: string | null;
  original: QuotedOriginalRow | null;
  /** direção da mensagem que CITA — palpite de direção quando a original some. */
  citingDirection: string;
  participantIsSelf?: boolean | null;
}): ReplyContextSnapshot | null {
  const { quotedId, payloadText, original, citingDirection, participantIsSelf } = args;
  if (original && (original.direction === "incoming" || original.direction === "outgoing")) {
    const own = stripQuotedPrefix(original.content ?? "").trim().slice(0, 4000);
    return {
      messageId: original.message_id,
      text: own || MEDIA_LABEL[original.message_type ?? ""] || payloadText || "Mensagem",
      direction: original.direction,
    };
  }
  if (!quotedId || !payloadText) return null;
  // Original ausente (histórico antigo/expirada): quem cita costuma citar a
  // outra ponta. `participant` desempata quando vem no payload.
  const direction: "incoming" | "outgoing" = typeof participantIsSelf === "boolean"
    ? (participantIsSelf ? "outgoing" : "incoming")
    : (citingDirection === "incoming" ? "outgoing" : "incoming");
  return { messageId: quotedId, text: payloadText.slice(0, 4000), direction };
}
