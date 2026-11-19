import { useEffect, useLayoutEffect, useState } from "react";

/**
 * A régua de espera do Torque (CX ①, mockup .specs/cx/regua-de-espera-mockup.html).
 *
 *   < 100 ms   nada aparece (a forma reserva o layout, invisível) — evita piscar
 *   ≥ 100 ms   skeleton com a forma real da tela
 *   ≥ 1 s      skeleton + frase do que está acontecendo, em voz de vendedor
 *   > 10 s     trabalho narrado — escolhido pela AÇÃO (estimativa conhecida
 *              antes de começar), nunca pelo relógio
 *
 * Skeleton que apareceu fica no mínimo 300 ms: sumir com 20 ms de vida é um
 * flash pior do que esperar um pouco mais.
 */
export const REGUA = { invisivelMs: 100, skeletonMinMs: 300, fraseMs: 1000, narradoMs: 10_000 } as const;

export type FaseEspera = "oculta" | "skeleton" | "skeleton+frase";

export const deveNarrar = (estimativaMs: number | null) => (estimativaMs ?? 0) > REGUA.narradoMs;

// Date.now (não performance.now): é o relógio que os fake timers controlam.
const agora = () => Date.now();

/**
 * Fase visual de uma espera. `ativo` = "o dado que a tela precisa ainda não
 * chegou" (`isPending && !data`) — nunca `isFetching`, senão todo refetch em
 * segundo plano vira skeleton por cima de dado bom.
 *
 * `segurando` = a espera acabou, mas o skeleton ainda cumpre os 300 ms
 * mínimos. Calculado no render, para que o quadro em que `ativo` cai não
 * mostre o conteúdo antes da hora.
 */
export function useFaseEspera(ativo: boolean): { fase: FaseEspera; segurando: boolean } {
  const [fase, setFase] = useState<FaseEspera>("oculta");
  const [skeletonDesde, setSkeletonDesde] = useState<number | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (skeletonDesde === null) {
      timers.push(
        setTimeout(() => {
          setSkeletonDesde(agora());
          setFase("skeleton");
        }, REGUA.invisivelMs),
      );
    } else {
      // Voltou a esperar durante o "segurando": o skeleton já está na tela.
      setFase((f) => (f === "oculta" ? "skeleton" : f));
    }
    timers.push(setTimeout(() => setFase("skeleton+frase"), REGUA.fraseMs));
    return () => timers.forEach(clearTimeout);
    // skeletonDesde lido só na virada de `ativo`, de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo]);

  // Layout effect: liberar o conteúdo acontece antes da pintura, sem um
  // quadro extra de skeleton.
  useLayoutEffect(() => {
    if (ativo) return;
    const liberar = () => {
      setSkeletonDesde(null);
      setFase("oculta");
    };
    if (skeletonDesde === null) {
      setFase("oculta");
      return;
    }
    const resta = REGUA.skeletonMinMs - (agora() - skeletonDesde);
    if (resta <= 0) {
      liberar();
      return;
    }
    const t = setTimeout(liberar, resta);
    return () => clearTimeout(t);
  }, [ativo, skeletonDesde]);

  const segurando =
    !ativo && skeletonDesde !== null && agora() - skeletonDesde < REGUA.skeletonMinMs;

  return { fase: ativo || segurando ? fase : "oculta", segurando };
}
