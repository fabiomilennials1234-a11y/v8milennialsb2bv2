import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProvenanceLine } from "./ProvenanceLine";
import { formatMetricValue, resolveHeadValue, typeScaleForWeight } from "@/modules/analytics/lib/tv-metric-format";
import { useFitToWidth } from "@/modules/analytics/lib/use-fit-to-width";
import type { ProvenanceInput } from "@/modules/analytics/lib/tv-provenance";

export type WidgetWeight = "hero" | "primary" | "secondary";
export type WidgetState = "loading" | "ready" | "error";

export interface WidgetFrameProps extends ProvenanceInput {
  /** ① A pergunta. UPPERCASE, --tv-label. Vem da config — nunca espera dado. */
  eyebrow: string;
  /** Peso amarra tamanho de célula à escala tipográfica. Não é estilo. */
  weight?: WidgetWeight;
  /** ② Valor de cabeça — obrigatório em TODO formato, inclusive gráficos. */
  value?: number | null;
  formatId?: string | null;
  /** Delta de comparação, colado ao bloco do valor — nunca no rodapé. */
  delta?: ReactNode;
  state?: WidgetState;
  /** ③ Corpo — a única região que varia entre os 7 formatos (fatias #1218+). */
  children?: ReactNode;
  className?: string;
}

/**
 * `WidgetFrame` — a casca (spec §1). Um componente-casca, sete corpos.
 *
 * É a moldura que faz 12 widgets diferentes lerem como um sistema: a 3m ninguém vê
 * estrutura interna, então igualadas moldura, paleta e escala, a incoerência deixa
 * de existir opticamente — inclusive com corpo legado dentro (§8.4.2).
 *
 * Entrega: moldura, eyebrow, escala --tv-*, superfície, borda e FAIXA DE PROVENIÊNCIA.
 * O MESMO componente serve TV e Comando; muda só o escopo de tema (§9.2).
 */
export function WidgetFrame({
  eyebrow,
  weight = "secondary",
  value,
  formatId,
  delta,
  state = "ready",
  children,
  className,
  ...provenance
}: WidgetFrameProps) {
  const errored = state === "error";
  const loading = state === "loading";
  // fit-to-width (§3.3): o valor encolhe até caber, piso 36px, nunca reticência/quebra.
  const valueRef = useFitToWidth<HTMLSpanElement>(typeScaleForWeight(weight));

  return (
    <div
      data-testid="tv-card"
      className={cn(
        // Superfície SÓLIDA — sem blur (§2.6): a 3m o blur vira mancha.
        "flex h-full min-w-0 flex-col rounded-xl bg-card p-5",
        // Borda VISÍVEL: border-white/5 some a 3m e a grid vira sopa.
        "border border-border",
        // Erro: o widget NÃO some (§5.3) — se sumir, a grid dança e o espectador
        // acha que alguém mudou a tela, o que é pior que o erro.
        errored && "border-destructive/30",
        className,
      )}
    >
      {/* ① Eyebrow — vem da configuração, não do dado: nunca precisa esperar. */}
      <div
        data-testid="tv-eyebrow"
        className="shrink-0 truncate font-semibold uppercase text-muted-foreground"
        style={{ fontSize: "var(--tv-label)", letterSpacing: "0.08em" }}
        title={eyebrow}
      >
        {eyebrow}
      </div>

      {/* ②③ Valor de cabeça CENTRALIZADO verticalmente entre o eyebrow e a
          proveniência (§1.1): o bloco vive numa região flex-1 com justify-center.
          Sem corpo (número/escalar), o valor fica no CENTRO óptico da célula — mata
          o vão de 70% do card alto. Com corpo (gráfico), o content flex-1 preenche
          e o valor sobe naturalmente. Delta colado ao valor. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          {loading ? (
            // Só o valor pulsa. SEM shimmer — o sweep a 3m lê como flicker.
            <span
              aria-hidden
              className="tv-value-loading inline-block rounded bg-muted"
              style={{ width: "4ch", height: "0.8em", fontSize: typeScaleForWeight(weight) }}
            />
          ) : (
            // Número NUNCA reticencia nem quebra linha (§3.2): sem `truncate`,
            // `whitespace-nowrap`. A moeda compacta (§2.6b) garante que caiba.
            <span
              ref={valueRef}
              data-testid="tv-value"
              className="min-w-0 whitespace-nowrap font-semibold leading-none text-foreground"
            >
              {/* empty_reason do motor vence o número: 0 com no_rows é ausência,
                  não dado (AC #7). resolveHeadValue devolve null → formata como —. */}
              {formatMetricValue(errored ? null : resolveHeadValue(value, provenance.emptyReason), formatId)}
            </span>
          )}
          {!loading && !errored && delta}
        </div>
        {/* Corpo — só p/ formatos com gráfico. `children` ausente (número) → região
            fica só com o valor → justify-center centra. */}
        {children ? <div data-testid="tv-content" className="mt-3 min-h-0 flex-1 overflow-hidden">{children}</div> : null}
      </div>

      {/* ④ Proveniência — obrigatória, sempre visível. */}
      <ProvenanceLine
        {...provenance}
        errored={errored}
        // Consulta ok e sem registros → ressalva `· sem registros` (§5.2).
        emptyReason={errored ? null : provenance.emptyReason}
      />
    </div>
  );
}
