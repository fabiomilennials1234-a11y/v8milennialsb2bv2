import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCommandPalette } from "@/modules/platform/components/command/useCommandPalette";
import { useOrganizationSettings } from "@/modules/identity";

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

  // SCRUM-637 (flip): os atalhos apontavam rotas que nunca existiram
  // (/qualificacao, /confirmacao, /propostas — teclas mortas desde sempre).
  // `g w` vai pro FUNIL PADRÃO da org (organizations.default_pipeline_id,
  // SCRUM-624 — a rota única aceita uuid); sem padrão, cai no hub /funis.
  const { settings } = useOrganizationSettings();
  const defaultFunnelPath = settings?.default_pipeline_id
    ? `/funil/${settings.default_pipeline_id}`
    : "/funis";

  const shortcuts: ShortcutDef[] = [
    { key: "g d", label: "Dashboard", group: "Navegacao", action: () => navigate("/"), seq: true },
    { key: "g l", label: "Leads", group: "Navegacao", action: () => navigate("/leads"), seq: true },
    { key: "g w", label: "Funil padrão", group: "Navegacao", action: () => navigate(defaultFunnelPath), seq: true },
    // SCRUM-641: `g c`/`g p` (rotas fixas /funil/confirmacao|propostas do trio
    // legado) morreram — funil é funil, nenhum atalho aponta slug fixo. O hub
    // /funis lista os funis reais da org.
    { key: "g f", label: "Funis", group: "Navegacao", action: () => navigate("/funis"), seq: true },
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
    // `defaultFunnelPath` entra nas deps: ele chega DEPOIS do primeiro render
    // (query) e o closure de `shortcuts` precisa ser refeito — senão `g w`
    // navega pro fallback pra sempre.
  }, [navigate, onShowHelp, openPalette, defaultFunnelPath]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return shortcuts;
}
