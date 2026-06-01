import { useState, type ReactNode } from "react";
import { useGlobalShortcuts } from "@/modules/platform/hooks/useGlobalShortcuts";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";

export function GlobalShortcutsProvider({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  useGlobalShortcuts({ onShowHelp: () => setHelpOpen(true) });

  return (
    <>
      {children}
      <KeyboardShortcutsOverlay open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
