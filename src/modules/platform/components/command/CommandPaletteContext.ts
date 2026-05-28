/**
 * CommandPaletteContext — contexto isolado para evitar warning react-refresh.
 * Separado do Provider para que o Provider exporte apenas componente.
 */
import { createContext, useContext } from "react";

export interface CommandPaletteContextType {
  isOpen: boolean;
  open: (initialQuery?: string) => void;
  close: () => void;
  toggle: () => void;
}

export const CommandPaletteContext = createContext<CommandPaletteContextType | undefined>(undefined);

export function useCommandPalette(): CommandPaletteContextType {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  }
  return ctx;
}
