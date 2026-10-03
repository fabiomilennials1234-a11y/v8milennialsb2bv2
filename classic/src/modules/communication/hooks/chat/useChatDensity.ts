/**
 * useChatDensity — FSM para modo de densidade das mensagens do chat.
 *
 * States: "compact" | "comfortable" | "spacious"
 * Storage: localStorage.chat-density-${userId} (user-scoped — B1 pattern)
 * Default: "comfortable"
 *
 * API:
 *   { density, setDensity, cycle, cssVars }
 *
 * cssVars: Record<string, string> pronto para spread no style inline do ChatShell,
 * sobrescrevendo os defaults de :root com os valores do preset ativo.
 *
 * Valores confirmados pelo UI spec (ui-spec-bubble-density.md, seção 4).
 */
import { useState, useCallback, useMemo } from "react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type DensityMode = "compact" | "comfortable" | "spacious";

// ─── Tokens por preset (tabela da seção 4 do UI spec) ────────────────────────

const DENSITY_TOKENS: Record<DensityMode, Record<string, string>> = {
  compact: {
    "--chat-bubble-padding-x":    "10px",
    "--chat-bubble-padding-y":    "6px",
    "--chat-msg-gap-same-author": "2px",
    "--chat-msg-gap-different":   "8px",
    "--chat-avatar-size":         "32px",
    "--chat-composer-min-h":      "36px",
    "--chat-list-row-height":     "56px",
  },
  comfortable: {
    "--chat-bubble-padding-x":    "14px",
    "--chat-bubble-padding-y":    "10px",
    "--chat-msg-gap-same-author": "4px",
    "--chat-msg-gap-different":   "12px",
    "--chat-avatar-size":         "40px",
    "--chat-composer-min-h":      "44px",
    "--chat-list-row-height":     "72px",
  },
  spacious: {
    "--chat-bubble-padding-x":    "18px",
    "--chat-bubble-padding-y":    "14px",
    "--chat-msg-gap-same-author": "6px",
    "--chat-msg-gap-different":   "16px",
    "--chat-avatar-size":         "48px",
    "--chat-composer-min-h":      "52px",
    "--chat-list-row-height":     "88px",
  },
};

// ─── Ordem do ciclo: comfortable → spacious → compact → comfortable ───────────

const CYCLE_ORDER: DensityMode[] = ["comfortable", "spacious", "compact"];

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChatDensity(userId: string | undefined) {
  const storageKey = userId ? `chat-density-${userId}` : null;

  const [density, setDensityState] = useState<DensityMode>(() => {
    if (!storageKey) return "comfortable";
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "compact" || stored === "comfortable" || stored === "spacious") {
        return stored;
      }
    } catch {
      // localStorage unavailable (private mode, etc.)
    }
    return "comfortable";
  });

  const setDensity = useCallback(
    (d: DensityMode) => {
      setDensityState(d);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, d);
        } catch {
          // localStorage unavailable — in-memory only
        }
      }
    },
    [storageKey],
  );

  const cycle = useCallback(() => {
    const currentIdx = CYCLE_ORDER.indexOf(density);
    const nextIdx = (currentIdx + 1) % CYCLE_ORDER.length;
    setDensity(CYCLE_ORDER[nextIdx]);
  }, [density, setDensity]);

  /** CSS vars prontas para spread em style inline do ChatShell root */
  const cssVars = useMemo(
    (): Record<string, string> => DENSITY_TOKENS[density],
    [density],
  );

  return { density, setDensity, cycle, cssVars };
}
