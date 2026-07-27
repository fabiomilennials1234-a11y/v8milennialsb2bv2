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
