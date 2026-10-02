/**
 * Dissolve em poeira — o `ThanosSnapEffect` do 21st.dev.
 * Inspirado no codepen de Mikhail Bespalov: https://codepen.io/Mikhail-Bespalov/pen/yLmpxOG
 *
 * ── O que mudou do original ────────────────────────────────────────────────
 * - **Controlado, não por clique.** O original dispara no `onClick` do filho e
 *   se restaura 500 ms depois — é uma demo. Aqui quem decide é `active`, e
 *   `onComplete` avisa quando a poeira assentou; o elemento FICA dissolvido
 *   (quem o usa é quem o remove).
 * - **Filtro só enquanto anima.** Filtro SVG com `feTurbulence` é caro. Deixado
 *   ligado em repouso, como no original, custaria um filtro por card num board
 *   de centenas de cards.
 * - **Id de filtro por instância.** O original fixava `#dissolve-filter`: duas
 *   instâncias na página compartilhariam o `feDisplacementMap` e a segunda
 *   animação mexeria na primeira. Na exclusão em lote há várias ao mesmo tempo.
 * - `framer-motion`, não `motion`: é o mesmo pacote (renomeado na v11), e o
 *   repo já carrega o `framer-motion` 12 no chunk `motion`.
 */
import { useEffect, useId, useRef, type PropsWithChildren } from "react";
import { motion, useAnimate, useMotionValue, useMotionValueEvent } from "framer-motion";
import { cn } from "@/lib/utils";

const DURATION_SECONDS = 0.6;
const MAX_DISPLACEMENT = 300;
const OPACITY_CHANGE_START = 0.5;
const transition = {
  duration: DURATION_SECONDS,
  ease: (time: number) => 1 - Math.pow(1 - time, 3),
};

export interface ThanosSnapEffectProps {
  /** `true` dispara a dissolução. Voltar para `false` não desfaz. */
  active: boolean;
  onComplete?: () => void;
  className?: string;
}

export function ThanosSnapEffect({ active, onComplete, className, children }: PropsWithChildren<ThanosSnapEffectProps>) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const displacementMapRef = useRef<SVGFEDisplacementMapElement>(null);
  const dissolveTargetRef = useRef<HTMLDivElement>(null);
  const displacement = useMotionValue(0);
  const started = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // `useId` devolve ":r1:" — dois-pontos quebram o `url(#…)` do CSS.
  const filterId = `dissolve-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useMotionValueEvent(displacement, "change", (latest) => {
    displacementMapRef.current?.setAttribute("scale", latest.toString());
  });

  useEffect(() => {
    if (!active || started.current || !dissolveTargetRef.current) return;
    started.current = true;
    const target = dissolveTargetRef.current;
    target.style.filter = `url(#${filterId})`;
    let cancelled = false;
    void Promise.all([
      animate(target, { scale: 1.2, opacity: [1, 1, 0] }, { ...transition, times: [0, OPACITY_CHANGE_START, 1] }),
      animate(displacement, MAX_DISPLACEMENT, transition),
    ]).then(() => {
      if (!cancelled) onCompleteRef.current?.();
    });
    return () => {
      cancelled = true;
    };
  }, [active, animate, displacement, filterId]);

  return (
    <div ref={scope} className={className}>
      <motion.div ref={dissolveTargetRef} className={cn(active && "pointer-events-none")}>
        {children}
      </motion.div>

      {active && (
        <svg width="0" height="0" className="absolute -z-10" aria-hidden>
          <defs>
            <filter id={filterId} x="-300%" y="-300%" width="600%" height="600%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves={1} result="bigNoise" />
              <feComponentTransfer in="bigNoise" result="bigNoiseAdjusted">
                <feFuncR type="linear" slope="0.5" intercept="-0.2" />
                <feFuncG type="linear" slope="3" intercept="-0.6" />
              </feComponentTransfer>
              <feTurbulence type="fractalNoise" baseFrequency="1" numOctaves={2} result="fineNoise" />
              <feMerge result="combinedNoise">
                <feMergeNode in="bigNoiseAdjusted" />
                <feMergeNode in="fineNoise" />
              </feMerge>
              <feDisplacementMap
                ref={displacementMapRef}
                in="SourceGraphic"
                in2="combinedNoise"
                scale="0"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      )}
    </div>
  );
}
