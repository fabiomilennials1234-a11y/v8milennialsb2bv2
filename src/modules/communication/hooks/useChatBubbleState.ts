/**
 * useChatBubbleState — persist {isOpen, isMinimized} no localStorage por userId.
 *
 * Chave: `chat-bubble:${userId}`. Falha silenciosa se localStorage indisponível
 * (modo privado, SSR, etc).
 *
 * Instância preferida é persistida separadamente via listInstanceFilter
 * (localStorage `chat-bubble:list-filter:${userId}`) no ChatBubbleContext.
 */
import { useCallback, useEffect, useState } from "react";

export interface ChatBubblePersistedState {
  isOpen: boolean;
  isMinimized: boolean;
}

const DEFAULT_STATE: ChatBubblePersistedState = {
  isOpen: false,
  isMinimized: false,
};

function storageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `chat-bubble:${userId}`;
}

function readState(userId: string | null | undefined): ChatBubblePersistedState {
  const key = storageKey(userId);
  if (!key || typeof localStorage === "undefined") return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<ChatBubblePersistedState>;
    return {
      isOpen: typeof parsed.isOpen === "boolean" ? parsed.isOpen : false,
      isMinimized: typeof parsed.isMinimized === "boolean" ? parsed.isMinimized : false,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(userId: string | null | undefined, state: ChatBubblePersistedState): void {
  const key = storageKey(userId);
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* QuotaExceededError ou modo privado — falha silenciosa */
  }
}

export function useChatBubbleState(userId: string | null | undefined) {
  const [state, setState] = useState<ChatBubblePersistedState>(() => readState(userId));

  // Re-sincroniza quando userId muda (troca de usuário sem reload)
  useEffect(() => {
    setState(readState(userId));
  }, [userId]);

  // Persiste ao mudar
  useEffect(() => {
    writeState(userId, state);
  }, [userId, state]);

  const setOpen = useCallback((isOpen: boolean) => {
    setState((prev) => (prev.isOpen === isOpen ? prev : { ...prev, isOpen }));
  }, []);

  const setMinimized = useCallback((isMinimized: boolean) => {
    setState((prev) => (prev.isMinimized === isMinimized ? prev : { ...prev, isMinimized }));
  }, []);

  const toggleMinimized = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: !prev.isMinimized }));
  }, []);

  return {
    isOpen: state.isOpen,
    isMinimized: state.isMinimized,
    setOpen,
    setMinimized,
    toggleMinimized,
  };
}
