/**
 * Segmented control — escolha única entre poucas opções, sempre visíveis.
 *
 * Existe ao lado do `Select` porque resolve outro problema. `Select` esconde as
 * opções atrás de um clique e serve quando são muitas ou variáveis; o segmented
 * mostra todas de uma vez e serve quando são poucas e fixas, e quando saber
 * **quais são as outras** faz parte da decisão. Filtrar leads entre Lead,
 * Cliente e Indefinido é esse caso: o usuário precisa ver que as três gavetas
 * existem.
 *
 * ── Por que o rótulo é desenhado DUAS vezes ──
 *
 * A camada de baixo tem os rótulos em estado inativo. O polegar carrega uma
 * cópia da fileira inteira e a translada no sentido contrário
 * (`maskX = -pos * 100%`), de modo que o rótulo visível dentro do polegar fique
 * sempre alinhado com o de baixo.
 *
 * O truque é o que evita o defeito clássico da alternativa óbvia: trocar a cor
 * do texto quando o polegar chega produz um flash — a cor muda de uma vez, o
 * polegar chega deslizando, e no meio do caminho o rótulo fica ilegível sobre a
 * borda dele. Aqui a transição da cor É o movimento do polegar, e não existe
 * instante de baixo contraste.
 *
 * ── Acessibilidade ──
 *
 * `radiogroup` + `radio`, com roving tabindex: um só Tab entra no grupo e as
 * setas andam entre as opções, que é o comportamento que um leitor de tela e um
 * teclado esperam de escolha única. Os botões são vazios com `sr-only` — o texto
 * visível vive nas camadas `aria-hidden`, senão o leitor de tela anunciaria cada
 * rótulo três vezes.
 *
 * `useReducedMotion` corta a animação e apenas posiciona o polegar.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";

import { cn } from "@/lib/utils";

/**
 * Mola, não duração. Distância maior leva naturalmente mais tempo, o que faz o
 * movimento parecer físico em vez de cronometrado — e é o que diferencia o
 * controle de um template.
 */
const SPRING = {
  type: "spring",
  stiffness: 520,
  damping: 34,
  mass: 0.45,
} as const;

/** Métrica compartilhada pelas duas camadas de rótulo — elas PRECISAM coincidir. */
const SEGMENT =
  "px-3 py-[7px] text-center text-[13px] font-medium leading-[18px] tracking-[-0.01em] whitespace-nowrap";

export type SegmentedOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  options: SegmentedOption[];
  /** Lido pelo leitor de tela ao entrar no grupo. Obrigatório de propósito. */
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

export function SegmentedControl({
  options,
  label,
  value,
  defaultValue,
  onValueChange,
  className,
}: SegmentedControlProps) {
  const count = Math.max(1, options.length);
  const template = `repeat(${count}, minmax(0, 1fr))`;

  const [internal, setInternal] = useState(
    () => defaultValue ?? options[0]?.value ?? "",
  );
  const [hovered, setHovered] = useState(-1);

  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const found = options.findIndex((o) => o.value === current);
  // Valor fora da lista (visão salva antiga, querystring adulterada) cairia em
  // -1 e jogaria o polegar para fora do controle. Ancorar no primeiro mantém o
  // componente renderizável.
  const index = found < 0 ? 0 : found;

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Ref em vez de dependência: o callback do consumidor costuma ser recriado a
  // cada render, e entrar na lista de dependências reanimaria o polegar à toa.
  const emit = useRef(onValueChange);
  emit.current = onValueChange;

  const reduced = useReducedMotion();
  const pos = useMotionValue(index);
  const thumbX = useTransform(pos, (v) => `${v * 100}%`);
  const maskX = useTransform(pos, (v) => `${v * -100}%`);

  useEffect(() => {
    if (reduced) {
      pos.set(index);
      return;
    }
    const controls = animate(pos, index, SPRING);
    return () => controls.stop();
  }, [index, reduced, pos]);

  const select = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      if (next !== current) emit.current?.(next);
    },
    [controlled, current],
  );

  /** Próximo índice habilitado — pula desabilitados e dá a volta. */
  const seek = useCallback(
    (from: number, dir: number) => {
      let i = from;
      for (let k = 0; k < count; k++) {
        i = (i + dir + count) % count;
        if (!options[i]?.disabled) return i;
      }
      return from;
    },
    [count, options],
  );

  const go = useCallback(
    (i: number) => {
      const option = options[i];
      if (!option || option.disabled) return;
      buttons.current[i]?.focus();
      select(option.value);
    },
    [options, select],
  );

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      go(seek(i, 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      go(seek(i, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      // Busca a partir do fim para a frente: assim "Home" pousa no primeiro
      // HABILITADO, não num desabilitado.
      go(seek(count - 1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      go(seek(0, -1));
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative inline-block select-none rounded-lg border border-border bg-muted/60 p-[3px]",
        "shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.06)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]",
        className,
      )}
    >
      <div
        className="relative grid"
        style={{ gridTemplateColumns: template, touchAction: "manipulation" }}
      >
        {/* Camada 1 — rótulos em repouso. Define a largura do controle. */}
        {options.map((option, i) => (
          <span
            key={option.value}
            aria-hidden
            className={cn(
              SEGMENT,
              "pointer-events-none transition-colors duration-150",
              option.disabled
                ? "text-muted-foreground/40"
                : hovered === i && i !== index
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
          >
            {option.label}
          </span>
        ))}

        {/* Camada 2 — o polegar, em gold, carregando sua própria cópia dos
            rótulos. Ver a nota no topo sobre por que o texto é duplicado. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-[6px] bg-primary shadow-sm"
          style={{ width: `${100 / count}%`, x: thumbX }}
          initial={false}
        >
          <motion.div className="absolute inset-0" style={{ x: maskX }} initial={false}>
            <div
              className="absolute inset-y-0 left-0 grid"
              style={{ width: `${count * 100}%`, gridTemplateColumns: template }}
            >
              {options.map((option) => (
                <span
                  key={option.value}
                  className={cn(SEGMENT, "text-primary-foreground")}
                >
                  {option.label}
                </span>
              ))}
            </div>
          </motion.div>
        </motion.div>

        {/* Camada 3 — alvos de clique. Vazios: o texto vive nas camadas
            `aria-hidden`, e repeti-lo aqui faria o leitor de tela anunciar cada
            rótulo três vezes. */}
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: template }}
          onPointerLeave={() => setHovered(-1)}
        >
          {options.map((option, i) => (
            <button
              key={option.value}
              ref={(node) => {
                buttons.current[i] = node;
              }}
              type="button"
              role="radio"
              aria-checked={i === index}
              aria-disabled={option.disabled || undefined}
              // Roving tabindex: um Tab entra no grupo, as setas navegam.
              tabIndex={i === index ? 0 : -1}
              onClick={() => !option.disabled && select(option.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onPointerEnter={() => !option.disabled && setHovered(i)}
              className={cn(
                "rounded-[6px] outline-none",
                option.disabled ? "cursor-not-allowed" : "cursor-pointer",
                "focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--ring))]",
              )}
            >
              <span className="sr-only">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SegmentedControl;
