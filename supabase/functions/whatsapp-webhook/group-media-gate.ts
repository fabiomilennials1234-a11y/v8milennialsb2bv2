import { isWhatsAppCdnUrl } from "../_shared/whatsapp-media.ts";

/**
 * Decide se a mídia da mensagem vai para o Storage.
 *
 * Grupo NUNCA baixa. O gate mora aqui, e não só no default de
 * `organizations.capture_groups`, porque uma org que religue a captura de grupo
 * deve recuperar o texto pesquisável sem voltar a pagar a mídia.
 *
 * Medido em prod (2026-08-10): mídia de grupo era 40 GB dos 100 GB do bucket
 * `media`, vinda de 978.452 mensagens de grupo que geraram 0 leads. Grupo já é
 * descartado de lead/copilot/pipeline em `persistMessage`, então esse download
 * alimentava apenas a conta de storage.
 *
 * Módulo separado do index.ts de propósito: importar o index levanta o
 * `Deno.serve` como efeito colateral, e um teste não deve subir servidor.
 */
export function shouldPersistMedia(normalized: {
  is_group: boolean;
  media_url: string | null;
  message_id: string | null;
}): boolean {
  if (normalized.is_group) return false;
  if (!normalized.media_url) return false;
  if (!normalized.message_id) return false;
  return isWhatsAppCdnUrl(normalized.media_url);
}
