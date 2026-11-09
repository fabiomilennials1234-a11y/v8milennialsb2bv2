/**
 * Ctrl+V de print/arquivo no composer (regras em `lib/pasted-attachment`).
 *
 * Ouve o documento, e não só o campo de texto: depois de clicar na lista de
 * mensagens o foco sai do campo, e o Ctrl+V tem que continuar funcionando.
 */

import { useEffect, useRef, type RefObject } from "react";
import { pastedFileFrom, shouldIgnorePaste } from "@/modules/communication/lib/pasted-attachment";

export function usePasteAttachment(
  composerRef: RefObject<Element | null>,
  enabled: boolean,
  onFile: (file: File) => void,
): void {
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (shouldIgnorePaste(event.target, composerRef.current)) return;
      const file = pastedFileFrom(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      onFileRef.current(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [composerRef, enabled]);
}
