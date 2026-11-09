/**
 * Colar (Ctrl+V) um print ou arquivo no composer do chat.
 *
 * Duas decisões que moram aqui para o desktop e o canal oficial não divergirem:
 *
 *  1. TEXTO VENCE. Copiar um intervalo do Excel ou um trecho do Word põe na área
 *     de transferência uma IMAGEM e o TEXTO. Colar tem que continuar colando o
 *     texto. Print de tela só traz imagem, e é esse caso que vira anexo.
 *  2. O print chega como `image.png`. Vira `captura-AAAAMMDD-HHMMSS.png`, que é
 *     o nome que aparece no preview.
 */

/** O recorte de `DataTransfer` que a regra lê (facilita o teste). */
export type PasteData = Pick<DataTransfer, "files" | "items" | "getData">;

const GENERIC_IMAGE_NAME = /^image\.(png|jpe?g|gif|webp)$/i;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const pad = (n: number) => String(n).padStart(2, "0");

function captureName(extension: string, now: Date): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `captura-${day}-${time}.${extension}`;
}

function firstFile(data: PasteData): File | null {
  const direct = data.files?.[0];
  if (direct) return direct;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** O arquivo a anexar, ou `null` para deixar o navegador colar o texto. */
export function pastedFileFrom(data: PasteData | null | undefined, now: Date = new Date()): File | null {
  if (!data) return null;
  try {
    if (data.getData("text/plain").trim() !== "") return null;
    const file = firstFile(data);
    if (!file) return null;
    const extension = EXTENSION_BY_MIME[file.type.toLowerCase()];
    if (extension && (!file.name || GENERIC_IMAGE_NAME.test(file.name))) {
      return new File([file], captureName(extension, now), { type: file.type, lastModified: file.lastModified });
    }
    return file;
  } catch {
    return null;
  }
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * `true` quando a colagem NÃO é do composer: outro campo de texto da página, ou
 * um modal aberto por cima. Foco solto (lista de mensagens, body) é do composer,
 * como no WhatsApp Web.
 */
export function shouldIgnorePaste(target: EventTarget | null, composerRoot: Element | null): boolean {
  if (!(target instanceof Element) || !composerRoot) return true;
  if (composerRoot.contains(target)) return false;
  return target.matches(EDITABLE) || target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}
