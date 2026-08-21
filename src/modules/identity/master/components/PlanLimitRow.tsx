/**
 * PlanLimitRow — linha de limite numérico na montagem da proposta.
 *
 * Componente PRÓPRIO, e não uma prop a mais no PlanFeatureCard: feature é
 * binária, limite é uma escala com um valor especial (-1 = Ilimitado). Enfiar
 * os dois no mesmo componente faria um deles carregar estado que não é dele.
 *
 * MOSTRA OS DOIS NÚMEROS, "base 5 → 12", nunca o delta.
 *
 * O delta parece mais compacto e está errado, e é o próprio código do repositório
 * que prova: `-1` significa ILIMITADO no editor de plano. Delta contra ilimitado
 * é aritmeticamente falso — "+(-6)" não quer dizer nada, enquanto
 * "base 50.000 → Ilimitado" quer. Campo que precisa de duas formas de leitura,
 * uma para o caso normal e outra para o caso especial, é campo mal desenhado.
 *
 * E o valor base é exatamente contra o que o operador está negociando: escondê-lo
 * obriga a abrir o catálogo noutra aba para saber se concedeu ou não.
 *
 * A direção usa o MESMO vocabulário do PlanFeatureCard — amarelo para "a mais",
 * prateado para "a menos" —, porque o sinal é DIREÇÃO, não tipo de campo.
 */

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, RotateCcw, Infinity as InfinityIcon } from "lucide-react";
import {
  LIMIT_UNLIMITED,
  formatLimit,
  limitDirection,
  type Direction,
} from "@/modules/billing/lib/package-diff";

// O comparador e o formatador vêm do módulo compartilhado DE PROPÓSITO. Esta
// linha já teve os seus próprios, e duas cópias do mesmo comparador é o defeito
// exato que o contador do topo sofreria: o card diria "a mais" e a contagem
// diria "a menos", porque um trata `-1` como ilimitado e o outro como número.
// Um comparador só, todo mundo consome.

interface PlanLimitRowProps {
  label: string;
  /**
   * Direção EXIBIDA, quando quem monta a lista precisa sobrepor a comparação —
   * é o caso do `settled` da R1, que não é derivável só de value vs baseValue.
   */
  displayAs?: Direction;
  description?: string;
  value: number;
  /** Valor do plano base. Ausente = editor de plano, que não tem base. */
  baseValue?: number;
  onChange: (value: number) => void;
}

export function PlanLimitRow({ label, description, value, baseValue, displayAs, onChange }: PlanLimitRowProps) {
  const direction: Direction =
    displayAs ?? (baseValue === undefined ? "same" : limitDirection(value, baseValue));

  return (
    <div
      className={cn(
        // Mesma borda de 3px sempre presente do PlanFeatureCard, pelo mesmo
        // motivo: sem ela a linha desloca quando vira diferença.
        "flex items-center justify-between gap-4 p-3 rounded-lg border border-l-[3px] border-l-transparent transition-colors",
        direction === "up" && "border-l-warning bg-warning/[0.06]",
        direction === "down" && "border-l-silver/70",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        )}
        {baseValue !== undefined && direction !== "same" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            base {formatLimit(baseValue)} → <span className="text-foreground font-medium">{formatLimit(value)}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {direction === "up" && (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border bg-warning/15 border-warning/30 text-foreground">
            <ArrowUp className="h-3 w-3 text-warning" />
            A mais
          </span>
        )}
        {direction === "settled" && (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border border-dashed border-border bg-transparent text-muted-foreground">
            <RotateCcw className="h-3 w-3 text-silver" />
            Voltou ao base
          </span>
        )}
        {direction === "down" && (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border bg-muted border-border text-muted-foreground">
            <ArrowDown className="h-3 w-3 text-silver" />
            A menos
          </span>
        )}
        <Input
          type="number"
          className="w-28 text-right"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {value === LIMIT_UNLIMITED && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
            <InfinityIcon className="h-3.5 w-3.5" />
            Ilimitado
          </span>
        )}
      </div>
    </div>
  );
}
