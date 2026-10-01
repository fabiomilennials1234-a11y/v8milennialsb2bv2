import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ThanosSnapEffect } from "@/components/ui/thanos-snap-effect";
import { removerFantasma, useFantasmas, type Fantasma } from "../../../lib/card-effects";

/**
 * Onde os cards excluídos viram poeira.
 *
 * Cada fantasma é um CLONE do card, tirado antes da exclusão, posto por cima
 * do lugar onde o card estava (`position: fixed`, no retângulo capturado). O
 * card real pode sumir quando o refetch chegar; o clone termina a poeira e se
 * remove. Ver `prepararDissolucao` em `lib/card-effects.ts`.
 *
 * Monte UM por superfície que tem cards (o board do funil).
 */
export function CardEffectsHost() {
  const fantasmas = useFantasmas();
  if (fantasmas.length === 0 || typeof document === "undefined") return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      {fantasmas.map((f) => (
        <Poeira key={f.id} fantasma={f} />
      ))}
    </div>,
    document.body,
  );
}

function Poeira({ fantasma }: { fantasma: Fantasma }) {
  const alvo = useRef<HTMLDivElement>(null);

  // Antes do paint: o clone tem de estar no lugar no primeiro quadro, ou o
  // card piscaria entre o sumiço do real e a entrada do clone.
  useLayoutEffect(() => {
    const host = alvo.current;
    if (!host) return;
    host.appendChild(fantasma.no);
    return () => {
      fantasma.no.remove();
    };
  }, [fantasma.no]);

  const { top, left, width, height } = fantasma.rect;
  return (
    <div className="absolute" style={{ top, left, width, height }}>
      <ThanosSnapEffect active onComplete={() => removerFantasma(fantasma.id)}>
        <div ref={alvo} />
      </ThanosSnapEffect>
    </div>
  );
}
