/**
 * Nome original de um documento do chat (Chamado f6fc3c9e).
 *
 * Ordem:
 *   1. `media_file_name` — coluna gravada no INSERT por trigger; sobrevive à
 *      retenção de 14 dias do `raw_payload`.
 *   2. `raw_payload.content.fileName` / `.title` (Uazapi) e
 *      `raw_payload.document.filename` (Meta) — linhas de realtime que chegam
 *      antes de a coluna existir no cache, ou bolhas otimistas.
 *   3. Nome derivado da URL de upload do CRM
 *      (`whatsapp-media/<org>/<uuid>/<nome>_<13 dígitos>.<ext>`).
 *   4. `null` — o chamador mostra "Documento".
 *
 * Nunca devolve o basename de uma URL de provider: sha256 de 64 hex, link
 * `.enc` do CDN do WhatsApp ou qualquer coisa com query string não são nome.
 */

export interface DocumentFileNameFields {
  media_file_name?: string | null;
  raw_payload?: unknown;
  media_url?: string | null;
}

const MAX_LENGTH = 255;
const CRM_UPLOAD_SEGMENT = "/whatsapp-media/";
const CRM_UPLOAD_BASENAME = /^(.+)_\d{13}\.([a-z0-9]{1,10})$/i;
const GENERIC_UPLOAD_BASE = /^(document|image|video|audio|sticker|file)_\d{13}$/i;
const HAS_EXTENSION = /\.[a-z0-9]{1,10}$/i;
const HEX_HASH_BASENAME = /^[0-9a-f]{32,}(\.[a-z0-9]{1,10})?$/i;

// Controle ASCII + controle de direção bidi (U+200E, U+200F, U+202A–U+202E,
// U+2066–U+2069). Sem isso `fatura<U+202E>fdp.exe` aparece como `faturaexe.pdf`.
// Mesmo conjunto de `whatsapp_messages_clean_file_name` no banco.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(UNSAFE_CHARS, "").trim();
  if (!trimmed || isOpaqueName(trimmed)) return null;
  return trimmed.slice(0, MAX_LENGTH);
}

function isOpaqueName(name: string): boolean {
  return name.includes("?") || /\.enc$/i.test(name) || HEX_HASH_BASENAME.test(name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function fromPayload(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const content = asRecord(root.content);
  const document = asRecord(root.document);
  return clean(content?.fileName) ?? clean(content?.title) ?? clean(document?.filename);
}

function fromCrmUploadUrl(url: string | null | undefined): string | null {
  if (!url || !url.includes(CRM_UPLOAD_SEGMENT)) return null;
  const path = url.split(/[?#]/)[0];
  let basename = path.slice(path.lastIndexOf("/") + 1);
  try {
    basename = decodeURIComponent(basename);
  } catch {
    // basename malformado: usa como veio
  }
  const match = CRM_UPLOAD_BASENAME.exec(basename);
  if (!match) return null;
  const [, base, ext] = match;
  if (GENERIC_UPLOAD_BASE.test(base)) return null;
  return clean(HAS_EXTENSION.test(base) ? base : `${base}.${ext}`);
}

export function readDocumentFileName(message: DocumentFileNameFields): string | null {
  return clean(message.media_file_name) ?? fromPayload(message.raw_payload) ?? fromCrmUploadUrl(message.media_url);
}
