/**
 * Anexos dos templates de mensagem (`/comando` no chat).
 *
 * Três regras que moram aqui para a tela e o envio não divergirem:
 *  1. Quais documentos entram (e a decisão é pela EXTENSÃO: no Windows um .csv
 *     chega como `application/vnd.ms-excel` ou com `type` vazio).
 *  2. O path no Storage guarda o nome ORIGINAL do arquivo. Sem isso o envio não
 *     sabe o nome e o proxy manda `file_<timestamp>` sem extensão.
 *  3. O nome é sempre ASCII: acento no key do Storage devolve `Invalid key`.
 *
 * O prefixo `templates/` é liberado pelas policies do bucket `media`
 * (`foldername(name)[1]`), então a org não precisa ir no path.
 */

/** Teto do bucket `media` (file_size_limit = 50 MB). */
export const TEMPLATE_MAX_BYTES = 50 * 1024 * 1024;

const WORD_PDF = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** Só liberados com a flag `template_anexos_office` (por org). */
const OFFICE = {
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
} as const;

const MIME_BY_EXT: Record<string, string> = { ...WORD_PDF, ...OFFICE };

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

function allowedExtensions(extended: boolean): string[] {
  return Object.keys(extended ? MIME_BY_EXT : WORD_PDF);
}

/** Valor do atributo `accept` do <input type="file"> de documento. */
export function templateDocumentAccept(extended: boolean): string {
  const exts = allowedExtensions(extended);
  const mimes = [...new Set(exts.map((e) => MIME_BY_EXT[e]))];
  return [...mimes, ...exts.map((e) => `.${e}`)].join(",");
}

/** MIME que o bucket permite para a extensão; `null` se não for documento de template. */
export function templateDocumentMime(fileName: string): string | null {
  return MIME_BY_EXT[extensionOf(fileName)] ?? null;
}

/** Mensagem de erro para o usuário, ou `null` se o arquivo pode subir. */
export function validateTemplateDocument(file: File, extended: boolean): string | null {
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > TEMPLATE_MAX_BYTES) return "O arquivo passa de 50 MB, o limite para templates.";
  const ext = extensionOf(file.name);
  if (!ext || !allowedExtensions(extended).includes(ext)) {
    const lista = allowedExtensions(extended)
      .map((e) => e.toUpperCase())
      .join(", ");
    return `Formato não aceito. Use: ${lista}.`;
  }
  return null;
}

const MAX_BASE_LENGTH = 80;

function asciiSafe(base: string): string {
  return base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** `templates/<uuid>/<nome-original-sanitizado>.<ext>` */
export function buildTemplateStoragePath(fileName: string, newId: () => string = () => crypto.randomUUID()): string {
  const lastSegment = fileName.split(/[\\/]/).pop() ?? "";
  const ext = extensionOf(lastSegment) || "bin";
  const base = lastSegment.replace(/\.[A-Za-z0-9]{1,10}$/, "");
  const safe = asciiSafe(base).slice(0, MAX_BASE_LENGTH).replace(/[-.]+$/, "") || "arquivo";
  return `templates/${newId()}/${safe}.${ext}`;
}

const LEGACY_UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]{1,10})$/i;

/**
 * Nome com que o documento sai no WhatsApp. Template antigo (`<uuid>.<ext>`)
 * não guardou o nome: devolve `documento.<ext>`, que ao menos abre.
 */
export function templateFileNameFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const pathname = url.split(/[?#]/)[0];
  const raw = pathname.split("/").pop() ?? "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // %-sequência inválida: usa o texto como veio.
  }
  const legacy = LEGACY_UUID_NAME.exec(name);
  if (legacy) return `documento.${legacy[1].toLowerCase()}`;
  return extensionOf(name) ? name : undefined;
}
