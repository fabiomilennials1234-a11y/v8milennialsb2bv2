import { useEffect, useRef, useState } from "react";

const KEY_PREFIX = "chat-draft-";

export function useConversationDraft(conversationKey: string) {
  const [draft, setDraftState] = useState<string>(() => {
    if (!conversationKey) return "";
    try {
      return localStorage.getItem(KEY_PREFIX + conversationKey) ?? "";
    } catch {
      return "";
    }
  });

  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!conversationKey) return;
    const stored = localStorage.getItem(KEY_PREFIX + conversationKey) ?? "";
    setDraftState(stored);
  }, [conversationKey]);

  const setDraft = (value: string) => {
    setDraftState(value);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      try {
        if (!conversationKey) return;
        if (value === "") localStorage.removeItem(KEY_PREFIX + conversationKey);
        else localStorage.setItem(KEY_PREFIX + conversationKey, value);
      } catch {
        // localStorage may be unavailable (private mode, quota exceeded)
      }
    }, 300);
  };

  return { draft, setDraft };
}
