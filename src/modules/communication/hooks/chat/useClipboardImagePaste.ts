/**
 * useClipboardImagePaste — Ctrl/⌘+V de imagem no campo de mensagem vira o
 * mesmo anexo pendente do botão de clipe.
 *
 * Devolve um handler de `onPaste` para pôr NO TEXTAREA do compositor — não no
 * container nem em `document`: assim colar na legenda ou em qualquer outro
 * campo continua sendo colar texto.
 *
 * Só intercepta (preventDefault) quando há imagem a anexar. Texto, e o
 * texto+imagem que Office/Sheets mandam, seguem o caminho nativo.
 *
 * `disabled` é o gate de envio: com envio em andamento a colagem não troca o
 * anexo (no ChatComposer, o `clearAttachment` pós-envio apagaria a imagem
 * recém-colada).
 *
 * O arquivo não é validado aqui — `onImage` é o mesmo handler do input de
 * arquivo, que já roda o validador do compositor.
 */
import { useCallback, type ClipboardEvent } from "react";
import { toast } from "sonner";
import { extractPastedImage } from "@/modules/communication/lib/clipboard-image";

export interface UseClipboardImagePasteOptions {
  onImage: (file: File) => void;
  disabled?: boolean;
}

export const MULTIPLE_IMAGES_NOTICE = "Só uma imagem por vez — anexei a primeira.";

export function useClipboardImagePaste({ onImage, disabled = false }: UseClipboardImagePasteOptions) {
  return useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      if (disabled) return;
      const { file, ignored } = extractPastedImage(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      if (ignored > 0) toast.info(MULTIPLE_IMAGES_NOTICE);
      onImage(file);
    },
    [onImage, disabled],
  );
}
