/**
 * useKeyboardOffset — detecta offset do teclado virtual iOS.
 *
 * Usa window.visualViewport API pra calcular a altura do teclado.
 * So ativa em mobile (via useViewport). Desktop sempre retorna 0.
 * Fallback: offset 0 quando visualViewport nao disponivel.
 */
import { useState, useEffect, useCallback } from "react";
import { useViewport } from "@/hooks/use-viewport";

export interface KeyboardOffset {
  /** Altura em px do teclado virtual (0 se fechado/desktop/sem API) */
  offset: number;
  /** true quando teclado visivel */
  isKeyboardOpen: boolean;
}

export function useKeyboardOffset(): KeyboardOffset {
  const { isMobile } = useViewport();
  const [offset, setOffset] = useState(0);

  const handleResize = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const delta = window.innerHeight - vv.height;
    setOffset(delta > 0 ? delta : 0);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setOffset(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    // Calcula estado inicial
    handleResize();

    vv.addEventListener("resize", handleResize);
    return () => {
      vv.removeEventListener("resize", handleResize);
    };
  }, [isMobile, handleResize]);

  return {
    offset,
    isKeyboardOpen: offset > 0,
  };
}
