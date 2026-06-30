import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCommandPalette } from "@/modules/platform/components/command/useCommandPalette";

interface ShortcutDef {
  key: string;
  label: string;
  group: string;
  action: () => void;
  seq?: boolean;
}

function isEditable(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

export function useGlobalShortcuts({ onShowHelp }: { onShowHelp: () => void }) {
  const navigate = useNavigate();
  const { open: openPalette } = useCommandPalette();
  const seqBuffer = useRef("");
  const seqTimer = useRef<ReturnType<typeof setTimeout>>();

  const shortcuts: ShortcutDef[] = [
    { key: "g d", label: "Dashboard", group: "Navegacao", action: () => navigate("/"), seq: true },
    { key: "g l", label: "Leads", group: "Navegacao", action: () => navigate("/leads"), seq: true },
    { key: "g w", label: "Funil WhatsApp", group: "Navegacao", action: () => navigate("/qualificacao"), seq: true },
    { key: "g c", label: "Confirmacao", group: "Navegacao", action: () => navigate("/confirmacao"), seq: true },
    { key: "g p", label: "Propostas", group: "Navegacao", action: () => navigate("/propostas"), seq: true },
    { key: "g m", label: "Chat", group: "Navegacao", action: () => navigate("/chat-whatsapp"), seq: true },
    { key: "?", label: "Atalhos", group: "Geral", action: onShowHelp },
  ];

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();

    if (key === "?") {
      e.preventDefault();
      onShowHelp();
      return;
    }

    // Sequence handling (e.g. "g" then "d")
    clearTimeout(seqTimer.current);

    if (seqBuffer.current) {
      const seq = `${seqBuffer.current} ${key}`;
      seqBuffer.current = "";
      const match = shortcuts.find(s => s.seq && s.key === seq);
      if (match) {
        e.preventDefault();
        match.action();
      }
      return;
    }

    // Check if this could start a sequence
    const possibleSeq = shortcuts.some(s => s.seq && s.key.startsWith(key + " "));
    if (possibleSeq) {
      seqBuffer.current = key;
      seqTimer.current = setTimeout(() => { seqBuffer.current = ""; }, 500);
      return;
    }

    // Single key shortcuts
    const match = shortcuts.find(s => !s.seq && s.key === key);
    if (match) {
      e.preventDefault();
      match.action();
    }
  }, [navigate, onShowHelp, openPalette]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return shortcuts;
}
