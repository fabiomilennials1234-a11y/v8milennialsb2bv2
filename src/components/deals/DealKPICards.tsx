import { BarChart3, Target, TrendingUp, TrendingDown, DollarSign, Percent, Hash, CalendarCheck } from "lucide-react";
import type { DealKPIs } from "@/hooks/useDeals";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  kpis: DealKPIs;
}

const cards = [
  { key: "forecastWeighted", label: "Forecast ponderado", icon: BarChart3, format: fmt },
  { key: "expectedThisMonth", label: "Previsto este mês", icon: Target, format: fmt },
  { key: "openCount", label: "Negócios abertos", icon: Hash, format: (v: number) => String(v) },
  { key: "avgProbability", label: "Probabilidade média", icon: Percent, format: (v: number) => `${v}%` },
  { key: "openValue", label: "Valor total aberto", icon: DollarSign, format: fmt },
  { key: "wonValueThisMonth", label: "Ganhos este mês", icon: TrendingUp, format: fmt },
  { key: "wonThisMonth", label: "Ganhos (qtd)", icon: CalendarCheck, format: (v: number) => String(v) },
  { key: "lostThisMonth", label: "Perdidos este mês", icon: TrendingDown, format: (v: number) => String(v) },
] as const;

export function DealKPICards({ kpis }: Props) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map(({ key, label, icon: Icon, format }) => (
        <div key={key} className="rounded-lg border bg-card p-4 flex items-start gap-3">
          <Icon className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold mt-0.5">
              {format(kpis[key as keyof DealKPIs] as number)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
