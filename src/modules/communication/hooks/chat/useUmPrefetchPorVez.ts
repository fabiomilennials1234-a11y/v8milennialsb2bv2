import { useCallback, useRef } from "react";

/**
 * Intenção que conta como "vai abrir esta conversa": 150 ms parado sobre a
 * linha (ou com foco nela). Mais curto que isso é o mouse atravessando a
 * lista; a regra de intenção em si é a primitiva `useIntencao` da régua.
 */
export const INTENCAO_DE_PREFETCH_MS = 150;

/**
 * Um prefetch em voo por vez, para a lista inteira.
 *
 * Rolar a lista com o mouse parado faz linhas passarem por baixo do ponteiro;
 * cada uma que cumprir a intenção pediria uma thread. Com um em voo, a
 * intenção que chega enquanto outro busca é DESCARTADA (não enfileirada): a
 * linha que importa é aquela onde o mouse parou por último, e ela pede de novo
 * quando o mouse voltar a ela.
 *
 * Falha de prefetch é palpite errado, não erro de tela: engolida aqui; o
 * clique refaz a busca pelo caminho normal, que sabe reportar.
 */
export function useUmPrefetchPorVez<T>(
  prefetch: ((alvo: T) => Promise<unknown> | void) | undefined,
): (alvo: T) => void {
  const prefetchRef = useRef(prefetch);
  prefetchRef.current = prefetch;
  const emVoo = useRef(false);

  return useCallback((alvo: T) => {
    const executar = prefetchRef.current;
    if (!executar || emVoo.current) return;
    emVoo.current = true;
    Promise.resolve()
      .then(() => executar(alvo))
      .catch(() => undefined)
      .finally(() => {
        emVoo.current = false;
      });
  }, []);
}
