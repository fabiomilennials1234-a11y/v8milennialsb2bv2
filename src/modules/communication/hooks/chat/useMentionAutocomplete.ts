/**
 * Estado do seletor de menção (@) para um campo de texto — o textarea do
 * composer ou o input da legenda. O campo continua controlado pelo dono
 * (`value`/`onChange`); este hook só sabe onde está o `@termo` sob o cursor e
 * como trocá-lo pelo token escolhido.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  applyMention,
  detectMentionTrigger,
  type MentionTrigger,
} from "@/modules/communication/lib/groupMentionComposer";

type TextField = HTMLInputElement | HTMLTextAreaElement;

export function useMentionAutocomplete<T extends TextField>({
  enabled,
  value,
  onChange,
  inputRef,
  resetKey,
  onOpen,
}: {
  enabled: boolean;
  value: string;
  onChange: (next: string) => void;
  inputRef: RefObject<T>;
  /** Mudou (ex.: troca de conversa) → o `@termo` aberto é descartado. */
  resetKey?: string;
  /** Chamado quando um `@termo` é detectado pelo vendedor. */
  onOpen?: () => void;
}) {
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);

  useEffect(() => {
    if (!enabled) setTrigger(null);
  }, [enabled]);

  useEffect(() => {
    setTrigger(null);
  }, [resetKey]);

  /** Recalcula a partir do campo (chamar no onChange / clique / setas). */
  const sync = useCallback((el: TextField | null) => {
    if (!enabled || !el) return setTrigger(null);
    const next = detectMentionTrigger(el.value, el.selectionStart ?? el.value.length);
    setTrigger(next);
    if (next) onOpen?.();
  }, [enabled, onOpen]);

  const close = useCallback(() => setTrigger(null), []);

  const select = useCallback((token: string) => {
    if (!trigger) return;
    const next = applyMention(value, trigger, token);
    onChange(next.text);
    setTrigger(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }, [trigger, value, onChange, inputRef]);

  return { trigger, sync, close, select };
}
