/**
 * CommandPaletteProvider — context global para o Command Palette (⌘K).
 *
 * C24: provider + atalho global ⌘K/Ctrl+K.
 * - Só abre quando user está autenticado (guard interno).
 * - Escape fecha (nativo do cmdk + keydown guard).
 * - Restore focus ao fechar: guarda activeElement antes de abrir.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/modules/identity";
import { CommandPaletteContext } from "./CommandPaletteContext";

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const previousFocusRef = useRef<Element | null>(null);

  const open = useCallback((_initialQuery?: string) => {
    if (!user) return; // guard: só abre autenticado
    previousFocusRef.current = document.activeElement;
    setIsOpen(true);
  }, [user]);

  const close = useCallback(() => {
    setIsOpen(false);
    // Restore focus para o elemento que estava focado antes de abrir
    if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
    previousFocusRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Atalho global ⌘K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <CommandPaletteContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}
