import { memo, useMemo } from "react";
import { useIndividualGoals } from "@/modules/engagement";
import { useCurrentTeamMember } from "@/modules/identity";
import { Skeleton } from "@/components/ui/skeleton";

interface IndividualGoalsListProps {
  month: number;
  year: number;
}

const AV_COLORS = [
  "linear-gradient(135deg, hsl(47 100% 50%), hsl(36 100% 58%))",
  "hsl(200 80% 50%)",
  "hsl(142 70% 45%)",
  "hsl(280 55% 55%)",
  "hsl(16 75% 55%)",
  "hsl(330 60% 55%)",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function barColor(pct: number): string {
  if (pct >= 80) return "hsl(var(--success))";
  if (pct >= 40) return "hsl(var(--primary))";
  return "hsl(var(--destructive))";
}
function textColor(pct: number): string {
  if (pct >= 80) return "text-success";
  if (pct >= 40) return "text-primary-soft-foreground";
  return "text-destructive";
}

/** Metas individuais — barra + % por vendedor, destaque pro usuário logado. */
function IndividualGoalsListBase({ month, year }: IndividualGoalsListProps) {
  const { data: goals, isLoading } = useIndividualGoals(month, year);
  const { data: me } = useCurrentTeamMember();

  const rows = useMemo(() => {
    const sales = (goals?.salesGoals ?? []).map((g) => ({ ...g, kind: "vendas" as const }));
    const meetings = (goals?.meetingsGoals ?? []).map((g) => ({ ...g, kind: "reuniões" as const }));
    return [...sales, ...meetings].sort((a, b) => b.percentage - a.percentage);
  }, [goals]);

  if (isLoading) {
    return <Skeleton className="h-full min-h-[200px] rounded-2xl" />;
  }

  return (
    // Corpo da janela "Metas individuais" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Vendas e reuniões</span>
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
          title="As metas seguem mensais mesmo com período personalizado selecionado."
        >
          mês
        </span>
      </div>
      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1">
        {rows.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhuma meta individual configurada.</p>
        )}
        {rows.map((g, i) => (
          <div
            key={`${g.kind}-${g.id}`}
            className={`grid grid-cols-[30px_1fr_52px] items-center gap-2.5 border-b border-border/60 py-2 last:border-b-0 ${
              g.id === me?.id ? "-mx-2 rounded-xl bg-primary-soft/60 px-2" : ""
            }`}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-[9px] text-[10.5px] font-extrabold text-background"
              style={{ background: AV_COLORS[i % AV_COLORS.length] }}
            >
              {initials(g.name)}
            </span>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[13px] font-semibold">{g.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-[.06em] text-muted-foreground">{g.kind}</span>
              </div>
              <div className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-muted">
                <i
                  className="block h-full rounded-full"
                  style={{ width: `${Math.min(g.percentage, 100)}%`, background: barColor(g.percentage) }}
                />
              </div>
            </div>
            <span className={`text-right text-[12px] font-extrabold tabular-nums ${textColor(g.percentage)}`}>
              {g.percentage}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const IndividualGoalsList = memo(IndividualGoalsListBase);
