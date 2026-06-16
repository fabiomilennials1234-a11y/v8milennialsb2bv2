import { Flame, Thermometer, Snowflake } from "lucide-react";
import { motion } from "framer-motion";

export interface CalorBarDatum {
  calor: number;
  /** Valor em aberto (R$). */
  value: number;
  count: number;
}

interface CalorBarsProps {
  data: CalorBarDatum[];
}

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

function thermo(calor: number) {
  if (calor >= 9) return { Icon: Flame, grad: "linear-gradient(90deg, hsl(14 90% 50%), hsl(0 75% 55%))", color: "text-destructive" };
  if (calor >= 7) return { Icon: Flame, grad: "linear-gradient(90deg, hsl(30 95% 50%), hsl(18 90% 52%))", color: "text-primary" };
  if (calor >= 5) return { Icon: Thermometer, grad: "linear-gradient(90deg, hsl(45 100% 50%), hsl(38 95% 50%))", color: "text-primary" };
  return { Icon: Snowflake, grad: "linear-gradient(90deg, hsl(210 60% 50%), hsl(200 80% 50%))", color: "text-chart-5" };
}

/** Valor em aberto por temperatura da proposta — gradiente térmico frio→quente. */
export function CalorBars({ data }: CalorBarsProps) {
  const sorted = [...data].sort((a, b) => b.calor - a.calor);
  const max = Math.max(...sorted.map((d) => d.value), 1);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center">
        Nenhuma proposta ativa no período
      </p>
    );
  }

  return (
    <div className="space-y-3.5">
      {sorted.map((row, i) => {
        const t = thermo(row.calor);
        return (
          <div key={row.calor} className="grid grid-cols-[88px_1fr_130px] items-center gap-3.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <t.Icon className={`w-3.5 h-3.5 ${t.color}`} />
              Calor {row.calor}
            </span>
            <div className="h-[22px] rounded-md bg-muted/50 overflow-hidden">
              <motion.div
                className="h-full rounded-md"
                style={{ background: t.grad }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max((row.value / max) * 100, 3)}%` }}
                transition={{ duration: 0.6, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <div className="text-right">
              <p className="text-[13.5px] font-bold tabular-nums">{brl(row.value)}</p>
              <p className="text-[10.5px] text-muted-foreground tabular-nums">
                {row.count} proposta{row.count !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
