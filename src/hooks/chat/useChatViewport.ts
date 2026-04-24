/**
 * useChatViewport — hook de breakpoint para o chat.
 *
 * Breakpoint 780px (especificado em ChatShell.tsx:13 — Onda 2b):
 *   isMobile  → viewport < 780px  (layout stack vertical)
 *   isCompact → viewport < 1100px (layout ainda 3-col mas comprimido)
 *
 * SSR-safe: estado inicial undefined, synca no primeiro effect.
 * Não substitui use-mobile.tsx (breakpoint 768px, usado em código legado).
 *
 * Onda 3.2 — Sprint 3.2.2
 */

import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 780;
const COMPACT_BREAKPOINT = 1100;

export interface ChatViewport {
  /** true quando viewport < 780px — ativa MobileChatLayout */
  isMobile: boolean;
  /** true quando viewport < 1100px — layout 3-col comprimido */
  isCompact: boolean;
  /** Largura atual do viewport (undefined no SSR / antes de montar) */
  width: number | undefined;
}

export function useChatViewport(): ChatViewport {
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);

    // Sincronizar no mount
    update();

    // Usar ResizeObserver para performance > window.resize
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;

    if (observer) {
      observer.observe(document.documentElement);
    } else {
      window.addEventListener("resize", update);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener("resize", update);
      }
    };
  }, []);

  return {
    width,
    isMobile: width !== undefined ? width < MOBILE_BREAKPOINT : false,
    isCompact: width !== undefined ? width < COMPACT_BREAKPOINT : false,
  };
}
