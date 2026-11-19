import { useCallback, useEffect, useMemo, useRef } from "react";

/** Mouse sintético que o navegador dispara depois de um toque. */
const JANELA_DO_TOQUE_MS = 800;

export interface HandlersDeIntencao {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onTouchStart: () => void;
}

/**
 * Intenção de abrir: o ponteiro (ou o foco do teclado) ficou `atrasoMs` sobre o
 * alvo. Passar por cima a caminho de outra coisa não dispara nada. Toque não é
 * intenção — no celular o "hover" é o próprio clique, e o `mouseenter` que o
 * navegador sintetiza depois do toque é ignorado.
 *
 * Trilho: 80 ms (só chunk). Card/conversa: 150 ms (dado do servidor).
 */
export function useIntencao(acao: () => void, atrasoMs: number): HandlersDeIntencao {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toqueEm = useRef(0);
  const acaoRef = useRef(acao);
  acaoRef.current = acao;

  const cancelar = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const agendar = useCallback(() => {
    if (Date.now() - toqueEm.current < JANELA_DO_TOQUE_MS) return;
    cancelar();
    timer.current = setTimeout(() => {
      timer.current = null;
      acaoRef.current();
    }, atrasoMs);
  }, [atrasoMs, cancelar]);

  useEffect(() => cancelar, [cancelar]);

  return useMemo(
    () => ({
      onMouseEnter: agendar,
      onMouseLeave: cancelar,
      onFocus: agendar,
      onBlur: cancelar,
      onTouchStart: () => {
        toqueEm.current = Date.now();
        cancelar();
      },
    }),
    [agendar, cancelar],
  );
}
