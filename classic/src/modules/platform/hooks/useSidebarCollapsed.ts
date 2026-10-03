/**
 * Preferência de lateral recolhida.
 *
 * Não usa `usePersistedState` de propósito: aquele expira em 24h e é escopado
 * por org. Recolher a lateral é preferência de máquina, não de organização —
 * quem recolhe quer a lateral recolhida amanhã também, em qualquer org.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "v8:ui:sidebar-collapsed";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Modo privado / storage bloqueado: expandida é o padrão seguro.
    return false;
  }
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Sem storage a preferência simplesmente não sobrevive ao reload.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  return [collapsed, toggle];
}
