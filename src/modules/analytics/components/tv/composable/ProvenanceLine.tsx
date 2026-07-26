import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildProvenanceVariants,
  fullProvenanceText,
  PROVENANCE_ERROR_TEXT,
  type ProvenanceInput,
} from "@/modules/analytics/lib/tv-provenance";

interface ProvenanceLineProps extends ProvenanceInput {
  /** Widget quebrado: a faixa vira o aviso de indisponível (§5.3). */
  errored?: boolean;
  className?: string;
}

/**
 * Faixa de proveniência (spec §4). Obrigatória em 100% dos widgets.
 *
 * NUNCA quebra em duas linhas. A escolha da variante é AJUSTE MEDIDO em tempo de
 * render — não limiar por contagem de célula. A prova da #1223 mostrou a linha
 * quebrando em card de exatamente 2 células a 1920, dentro do limite antigo:
 * contagem de célula é procuração para largura, e procuração falha.
 */
export function ProvenanceLine({ errored, className, ...input }: ProvenanceLineProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const variants = errored ? [PROVENANCE_ERROR_TEXT] : buildProvenanceVariants(input);
  const [level, setLevel] = useState(0);

  // Reinicia a degradação quando o conteúdo muda — senão herda o nível de um
  // texto anterior mais longo e degrada sem precisar.
  const signature = variants[0] ?? "";
  useEffect(() => setLevel(0), [signature]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || variants.length <= 1) return;

    const fit = () => {
      setLevel((current) => {
        // +1px de folga: subpixel de layout não deve disparar degradação.
        if (el.scrollWidth > el.clientWidth + 1 && current < variants.length - 1) {
          return current + 1;
        }
        return current;
      });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [signature, level, variants.length]);

  if (variants.length === 0) return null;

  const text = variants[Math.min(level, variants.length - 1)];
  const degraded = !errored && level > 0;

  return (
    <div
      className={cn(
        // Altura fixa + separador de 1px a 50% (§4.1). Repetida em 12 widgets,
        // vira textura — mesma altura, mesma cor, mesma posição.
        "mt-auto shrink-0 border-t border-border/50 pt-2",
        className,
      )}
    >
      <span
        ref={ref}
        // Nunca quebra em duas linhas (§4.4).
        className={cn(
          "block truncate whitespace-nowrap text-muted-foreground",
          errored && "text-destructive/80",
        )}
        style={{ fontSize: "var(--tv-meta)", lineHeight: 1.3 }}
        // Quando degradada, o texto completo continua disponível a leitor de tela.
        aria-label={degraded ? fullProvenanceText(input) : undefined}
        title={degraded ? fullProvenanceText(input) : undefined}
      >
        {text}
      </span>
    </div>
  );
}
