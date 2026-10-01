import { useCallback, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "framer-motion";
import { DealOutcomeCelebration, type Celebracao } from "./DealOutcomeCelebration";

/**
 * A celebração de ganho/perda dentro do painel do negócio.
 *
 * Duas etapas, porque a origem do voo e a confirmação acontecem em momentos
 * diferentes:
 *
 *   1. `origemDo(tipo)` no CLIQUE — o retângulo do botão "Ganhou"/"Perdeu".
 *      Depois da RPC o negócio vira "ganho" e o botão some do cabeçalho.
 *   2. `celebrar(tipo, origem)` só quando o BANCO confirmou. Comemorar antes
 *      e receber recusa (a trava de valor, por exemplo) seria mentir.
 *
 * `camada` vai dentro do contêiner `relative` do painel.
 * Com `prefers-reduced-motion`, `celebrar` não faz nada.
 */
export function useCelebracaoDoDesfecho(container: RefObject<HTMLElement>) {
  const [celebracao, setCelebracao] = useState<Celebracao | null>(null);
  const seq = useRef(0);
  const reduzido = useReducedMotion();

  const origemDo = useCallback(
    (tipo: "won" | "lost"): DOMRect | null =>
      container.current?.querySelector<HTMLElement>(`[data-desfecho="${tipo}"]`)?.getBoundingClientRect() ?? null,
    [container],
  );

  const celebrar = useCallback(
    (tipo: "won" | "lost", origem: DOMRect | null) => {
      if (reduzido) return;
      setCelebracao({ id: ++seq.current, tipo, origem });
    },
    [reduzido],
  );

  const encerrar = useCallback(() => setCelebracao(null), []);

  const camada = celebracao ? (
    <DealOutcomeCelebration key={celebracao.id} celebracao={celebracao} container={container} onFim={encerrar} />
  ) : null;

  return { origemDo, celebrar, camada };
}
