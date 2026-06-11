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
  return "hsl(0 62% 52%)";
}
function textColor(pct: number): string {
  if (pct >= 80) return "text-success";
  if (pct >= 40) return "text-primary";
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
    return <Skeleton className="h-[280px] rounded-2xl" />;
  }

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".2s" }}>
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">Metas individuais</span>
        <span className="text-[11px] font-semibold text-muted-foreground/60">vendas e reuniões</span>
      </div>
      <div className="mt-2 max-h-[280px] overflow-y-auto pr-1">
        {rows.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhuma meta individual configurada.</p>
        )}
        {rows.map((g, i) => (
          <div
            key={`${g.kind}-${g.id}`}
            className={`grid grid-cols-[30px_1fr_52px] items-center gap-2.5 border-b border-border/70 py-2 last:border-b-0 ${
              g.id === me?.id ? "rounded-lg bg-primary/5 px-2 -mx-2" : ""
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
                <span className="truncate text-[12.5px] font-semibold">{g.name}</span>
                <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-muted-foreground/50">{g.kind}</span>
              </div>
              <div className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-background">
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
