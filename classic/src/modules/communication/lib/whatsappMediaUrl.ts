/**
 * Mídia do WhatsApp que o navegador não consegue abrir sozinha.
 *
 * Mídia de grupo (e documento 1:1 cujo download falhou) fica com o link
 * criptografado da CDN do WhatsApp em `media_url` — `.enc` sem chave. O gate de
 * custo de 10/08 impede o servidor de baixar mídia de grupo, então a única
 * forma de abrir é pedir sob clique pelo `downloadMedia`.
 */

const WHATSAPP_CDN_DOMAINS = ["whatsapp.net", "whatsapp.com"];

/** Só subdomínio de whatsapp.net/.com: `evil.com/?x=.whatsapp.net/` e `whatsapp.net.evil.com` não passam. */
export function isWhatsAppCdnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return WHATSAPP_CDN_DOMAINS.some((d) => host.endsWith(`.${d}`));
}

/** Decodifica o base64 (com ou sem prefixo `data:`) devolvido por `downloadMedia`. */
export function base64ToBlob(base64: string, mimetype: string | null | undefined): Blob {
  const pure = base64.includes(",") ? base64.split(",")[1] : base64;
  const bin = Uint8Array.from(atob(pure), (c) => c.charCodeAt(0));
  return new Blob([bin], { type: mimetype || "application/octet-stream" });
}
