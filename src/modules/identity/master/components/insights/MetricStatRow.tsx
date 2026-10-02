import { Info } from "lucide-react";
import { useCountUp } from "@/shared/hooks/useCountUp";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { InsightsMode } from "./InsightsModeTabs";
import { formatBRL, formatInt } from "./lib/format";

interface MetricStatRowProps {
  ticketMedio: number;
  numVendas: number;
  faturamento: number;
  mode: InsightsMode;
  /** Período-calendário observado (rótulo pt-BR). Só na aba Dados. */
  periodLabel?: string;
}

type StatKind = "currency" | "int" | "currency-cents";

interface StatCardProps {
  label: string;
  value: number;
  kind: StatKind;
  mode: InsightsMode;
  /** Tooltip de esclarecimento ao lado do rótulo (ícone Info). */
  tooltip?: string;
}

function formatStat(value: number, kind: StatKind): string {
  if (kind === "int") return formatInt(value);
  if (kind === "currency-cents") return formatBRL(value, { cents: true });
  return formatBRL(value);
}

function StatCard({ label, value, kind, mode, tooltip }: StatCardProps) {
  const animated = useCountUp(value, 600);

  return (
    <div className="relative overflow-hidden rounded-card border border-card-border bg-card text-card-foreground shadow-relevo p-[18px] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none">
      <span
        className="absolute inset-y-0 left-0 w-[3px] bg-insights"
        aria-hidden="true"
      />
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          {label}
        </p>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Sobre ${label}`}
                className="inline-flex text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
        {mode === "projecao" && (
          <span className="rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-[.06em] text-warning-strong">
            meta
          </span>
        )}
      </div>
      <p className="mt-2 text-[1.65rem] font-extrabold leading-[1.05] tabular-nums tracking-[-0.04em] text-foreground">
        {formatStat(animated, kind)}
      </p>
    </div>
  );
}

/**
 * KPI row (DESIGN §7): Ticket médio · Nº de vendas · Faturamento.
 * Reveal via `useCountUp` (~600ms), recount em troca de horizonte/org.
 *
 * Na aba Dados o "Nº de vendas" é uma COORTE (leads criados no período que
 * viraram venda — mesma base da aba Saúde), com período explícito + tooltip.
 */
export function MetricStatRow({
  ticketMedio,
  numVendas,
  faturamento,
  mode,
  periodLabel,
}: MetricStatRowProps) {
  const isDados = mode === "dados";

  return (
    <div className="space-y-2.5">
      {isDados && periodLabel && (
        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Coorte · {periodLabel}
        </p>
      )}
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-3")}>
        <StatCard label="Ticket médio" value={ticketMedio} kind="currency-cents" mode={mode} />
        <StatCard
          label="Nº de vendas"
          value={numVendas}
          kind="int"
          mode={mode}
          tooltip={
            isDados
              ? "Viraram venda — leads criados no período que fecharam (mesma base da aba Saúde). Coortes recentes ainda estão maturando."
              : undefined
          }
        />
        <StatCard label="Faturamento" value={faturamento} kind="currency" mode={mode} />
      </div>
    </div>
  );
}
