/**
 * O que o "Encaminhar" aceita. Espelha `planForward` do servidor
 * (supabase/functions/_shared/forward-message.ts): a UI só esconde o botão, quem
 * decide é o servidor, que lê a mensagem do banco.
 *
 * Mídia só vai quando já existe arquivo nosso: o link criptografado da CDN do
 * WhatsApp (mídia de grupo ainda não carregada) não é enviável.
 */
import { isWhatsAppCdnUrl } from "./whatsappMediaUrl";

export interface ForwardableFields {
  message_type?: string | null;
  content?: string | null;
  media_url?: string | null;
  media_expired?: boolean | null;
  deleted_at?: string | null;
}

const TEXT_TYPES = new Set(["text", "conversation"]);
const MEDIA_TYPES = new Set(["image", "video", "document", "audio", "ptt", "sticker"]);

export function isForwardableMessage(m: ForwardableFields): boolean {
  if (m.deleted_at) return false;
  const type = m.message_type ?? "";
  if (TEXT_TYPES.has(type)) return !!(m.content ?? "").trim();
  if (!MEDIA_TYPES.has(type)) return false;
  return !!m.media_url && !m.media_expired && !isWhatsAppCdnUrl(m.media_url);
}
