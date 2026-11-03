import { useCallback, useState } from "react";

const CHAVE = (id: string) => `torque:novidade-vista:${id}`;

/** localStorage pode lançar (janela privada, dados bloqueados): a tela tem de funcionar sem ele. */
function jaViu(id: string): boolean {
  try {
    return window.localStorage.getItem(CHAVE(id)) === "1";
  } catch {
    return false;
  }
}

/**
 * "Já vi esta novidade" por navegador. `marcar` grava e apaga o selo na hora.
 * Sem armazenamento, o selo some só até recarregar, e o prazo do item o encerra de qualquer forma.
 */
export function useNovidadeVista(id: string | undefined): { vista: boolean; marcar: () => void } {
  const [vista, setVista] = useState<boolean>(() => (id ? jaViu(id) : true));
  const marcar = useCallback(() => {
    if (!id) return;
    try {
      window.localStorage.setItem(CHAVE(id), "1");
    } catch {
      /* sem armazenamento: só a sessão */
    }
    setVista(true);
  }, [id]);
  return { vista, marcar };
}
