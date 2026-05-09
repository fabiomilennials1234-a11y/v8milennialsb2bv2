import { useEffect, useCallback, useRef } from "react";

type ShortcutHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  /** Single key like "n" or chord like "g d" (press g then d within 500ms) */
  keys: string;
  handler: ShortcutHandler;
  /** Description shown in the help overlay */
  description: string;
  /** Scope for grouping in help overlay */
  scope?: string;
}

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (INPUT_TAGS.has(el.tagName)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Registers keyboard shortcuts that fire only when no input is focused.
 * Supports single keys ("n", "?") and two-key chords ("g d", "g c").
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const pendingChordRef = useRef<string | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      // Build key identifier
      const key = e.key.toLowerCase();

      // Check for chord completion
      if (pendingChordRef.current) {
        const chord = `${pendingChordRef.current} ${key}`;
        pendingChordRef.current = null;
        if (chordTimerRef.current) {
          clearTimeout(chordTimerRef.current);
          chordTimerRef.current = null;
        }

        const match = shortcuts.find((s) => s.keys === chord);
        if (match) {
          e.preventDefault();
          match.handler(e);
          return;
        }
      }

      // Check for single-key match
      const singleMatch = shortcuts.find((s) => s.keys === key && !s.keys.includes(" "));
      if (singleMatch) {
        e.preventDefault();
        singleMatch.handler(e);
        return;
      }

      // Check if this key starts a chord
      const startsChord = shortcuts.some((s) => s.keys.startsWith(`${key} `));
      if (startsChord) {
        pendingChordRef.current = key;
        chordTimerRef.current = setTimeout(() => {
          pendingChordRef.current = null;
        }, 500);
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
    };
  }, [handleKeyDown]);
}

/**
 * Global shortcuts shared across the entire app.
 * Returns the shortcut definitions for the help overlay.
 */
export function useGlobalShortcuts(callbacks: {
  onNewLead?: () => void;
  onGoDashboard?: () => void;
  onGoChat?: () => void;
  onGoFunis?: () => void;
  onShowHelp?: () => void;
}) {
  const shortcuts: Shortcut[] = [];

  if (callbacks.onNewLead) {
    shortcuts.push({
      keys: "n",
      handler: () => callbacks.onNewLead!(),
      description: "Novo lead",
      scope: "Global",
    });
  }

  if (callbacks.onGoDashboard) {
    shortcuts.push({
      keys: "g d",
      handler: () => callbacks.onGoDashboard!(),
      description: "Ir para Dashboard",
      scope: "Global",
    });
  }

  if (callbacks.onGoChat) {
    shortcuts.push({
      keys: "g c",
      handler: () => callbacks.onGoChat!(),
      description: "Ir para Chat",
      scope: "Global",
    });
  }

  if (callbacks.onGoFunis) {
    shortcuts.push({
      keys: "g f",
      handler: () => callbacks.onGoFunis!(),
      description: "Ir para Funis",
      scope: "Global",
    });
  }

  if (callbacks.onShowHelp) {
    shortcuts.push({
      keys: "?",
      handler: () => callbacks.onShowHelp!(),
      description: "Mostrar atalhos",
      scope: "Global",
    });
  }

  useKeyboardShortcuts(shortcuts);

  return shortcuts;
}

export type { Shortcut };
