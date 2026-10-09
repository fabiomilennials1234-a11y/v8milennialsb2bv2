/**
 * extractPastedImage — transforma o conteúdo de um Ctrl/⌘+V num anexo.
 *
 * Função pura, sem DOM: recebe só o que precisa do `DataTransfer` para que o
 * teste monte o clipboard à mão e o Safari (que às vezes entrega `items` vazio
 * e `files` preenchido) caiba no mesmo contrato.
 *
 * REGRAS
 *  - Texto não vazio GANHA da imagem. Office/Sheets copiam célula como
 *    text/plain + text/html + image/png; quem cola uma planilha quer o texto.
 *  - Só `image/*`. PDF e afins no clipboard não viram anexo por aqui — o
 *    caminho de documento é o botão de anexo.
 *  - Um anexo por vez (todos os compositores aceitam um só): devolve a primeira
 *    imagem e conta as outras em `ignored`, para o chamador avisar.
 *  - NÃO valida formato nem tamanho. Isso é do validador de cada compositor
 *    (`getAttachmentValidationError` / `classifyAttachment`); validar aqui
 *    duplicaria a regra e as duas divergiriam.
 *  - Print chega como `image.png` (ou sem nome) — vira
 *    `print-AAAAMMDD-HHmmss.<ext>`, para o atendente reconhecer no preview e
 *    para dois prints não terem o mesmo nome. Nome real é preservado.
 */

export type PastedData = Pick<DataTransfer, "items" | "files" | "getData">;

export interface PastedImage {
  file: File | null;
  ignored: number;
}

const NOTHING: PastedImage = { file: null, ignored: 0 };

/** Nomes que o navegador/SO inventa para imagem sem arquivo de origem. */
const GENERIC_NAME = /^(?:image|blob|pasted ?graphic|untitled)?(?:\.[a-z0-9]+)?$/i;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function isImage(type: string | undefined | null): boolean {
  return (type ?? "").toLowerCase().startsWith("image/");
}

function readText(data: PastedData): string {
  try {
    return data.getData("text/plain") ?? "";
  } catch {
    return "";
  }
}

function imagesFromItems(items: DataTransferItemList | undefined | null): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.kind !== "file" || !isImage(item.type)) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function imagesFromFiles(files: FileList | undefined | null): File[] {
  if (!files) return [];
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file && isImage(file.type)) out.push(file);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

function syntheticName(type: string, now: Date): string {
  const mime = type.toLowerCase();
  const ext = EXTENSION_BY_MIME[mime] ?? (mime.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "png");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `print-${stamp}.${ext}`;
}

export function extractPastedImage(
  data: PastedData | null | undefined,
  now: Date = new Date(),
): PastedImage {
  if (!data) return NOTHING;
  if (readText(data).trim()) return NOTHING;

  // items é a fonte canônica; files só como fallback (Safari). Ler os dois e
  // concatenar duplicaria a mesma imagem.
  const fromItems = imagesFromItems(data.items);
  const images = fromItems.length > 0 ? fromItems : imagesFromFiles(data.files);
  const [first] = images;
  if (!first) return NOTHING;

  const file = GENERIC_NAME.test(first.name.trim())
    ? new File([first], syntheticName(first.type, now), {
        type: first.type,
        lastModified: now.getTime(),
      })
    : first;

  return { file, ignored: images.length - 1 };
}
