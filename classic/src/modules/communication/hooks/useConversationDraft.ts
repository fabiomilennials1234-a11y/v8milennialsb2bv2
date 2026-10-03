import { useEffect, useRef, useState } from "react";

const KEY_PREFIX = "chat-draft-";

/**
 * Returns the user-scoped localStorage key for a given conversation.
 * Format: `chat-draft-${userId}-${conversationKey}`
 * If userId is absent (not yet authenticated or loading), returns null
 * so the caller can avoid persisting PII before we know who the user is.
 */
function buildKey(userId: string | undefined, conversationKey: string): string | null {
  if (!userId || !conversationKey) return null;
  return `${KEY_PREFIX}${userId}-${conversationKey}`;
}

/**
 * One-shot migration: remove orphan draft keys that were written before the
 * user-scoping fix (Onda 1 format: `chat-draft-${instanceId}:${phoneNumber}`).
 * Called once on first load so stale PII is cleaned up.
 */
function removeOrphanDrafts(): void {
  try {
    const orphanPattern = /^chat-draft-[^-].*:[^:]+$/;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && orphanPattern.test(key)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage may be unavailable (private mode, SSR)
  }
}

let orphanCleanupDone = false;

export function useConversationDraft(conversationKey: string, userId: string | undefined) {
  // Run one-shot orphan cleanup on first hook mount
  if (!orphanCleanupDone) {
    orphanCleanupDone = true;
    removeOrphanDrafts();
  }

  const storageKey = buildKey(userId, conversationKey);

  const [draft, setDraftState] = useState<string>(() => {
    if (!storageKey) return "";
    try {
      return localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });

  const timeoutRef = useRef<number | null>(null);

  // Re-read from localStorage when conversationKey or userId changes
  useEffect(() => {
    if (!storageKey) {
      setDraftState("");
      return;
    }
    try {
      setDraftState(localStorage.getItem(storageKey) ?? "");
    } catch {
      setDraftState("");
    }
  }, [storageKey]);

  const setDraft = (value: string) => {
    setDraftState(value);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      try {
        if (!storageKey) return; // no userId yet — do not persist PII
        if (value === "") localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, value);
      } catch {
        // localStorage may be unavailable (private mode, quota exceeded)
      }
    }, 300);
  };

  return { draft, setDraft };
}
