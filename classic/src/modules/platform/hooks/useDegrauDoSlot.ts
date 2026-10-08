import { useLayoutEffect, useState, type RefObject } from "react";
import { degrauDoSlot, type DegrauDoSlot } from "../lib/slot-do-oraculo";

export interface ElementosDaLateral {
  lateralRef: RefObject<HTMLElement | null>;
  topoRef: RefObject<HTMLElement | null>;
  rodapeRef: RefObject<HTMLElement | null>;
  navRef: RefObject<HTMLElement | null>;
  colapsada: boolean;
  temBriefing: boolean;
}

function alturaDe(ref: RefObject<HTMLElement | null>): number {
  return ref.current?.offsetHeight ?? 0;
}

/**
 * Qual forma o slot do Oráculo assume, medindo os elementos da própria lateral.
 *
 * A medição sai do `<aside>` e não de `window`: zoom do navegador e fonte
 * grande do sistema mudam a altura da coluna sem mudar a da janela, e é a
 * coluna que decide o degrau.
 *
 * Mede em `useLayoutEffect` — antes da pintura, para o slot não piscar no
 * degrau errado.
 */
export function useDegrauDoSlot(elementos: ElementosDaLateral): DegrauDoSlot {
  const { lateralRef, topoRef, rodapeRef, navRef, colapsada, temBriefing } =
    elementos;
  const [degrau, setDegrau] = useState<DegrauDoSlot>("ausente");

  useLayoutEffect(() => {
    const medir = () =>
      setDegrau(
        degrauDoSlot({
          alturaDaLateral: alturaDe(lateralRef),
          alturaDoTopo: alturaDe(topoRef),
          alturaDoRodape: alturaDe(rodapeRef),
          alturaNaturalDaNavegacao: alturaDe(navRef),
          colapsada,
          temBriefing,
        }),
      );

    // A primeira medição é síncrona de propósito: esperar o observador faria o
    // slot pintar uma vez no degrau errado.
    medir();

    const alvo = lateralRef.current;
    if (!alvo) return;

    const observador = new ResizeObserver(medir);
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [lateralRef, topoRef, rodapeRef, navRef, colapsada, temBriefing]);

  return degrau;
}
