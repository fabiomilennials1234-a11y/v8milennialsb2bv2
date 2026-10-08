import { memo, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useRankingData } from "@/modules/analytics/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";

interface RankingPodiumProps {
  /** Intervalo global do Comando — o ranking segue o período selecionado. */
  range: { start: Date; end: Date };
  /** vendaTotal do período (RPC) — detecta vendas sem vendedor atribuído. */
  teamSalesTotal?: number;
}

type Mode = "vendas" | "reunioes";

const AV_COLORS = [
  "linear-gradient(135deg, hsl(47 100% 50%), hsl(36 100% 58%))",
  "hsl(200 80% 50%)",
  "hsl(142 70% 45%)",
  "hsl(280 55% 55%)",
  "hsl(16 75% 55%)",
  "hsl(330 60% 55%)",
];

const BAR_COLORS = [
  "hsl(47 100% 50%)",
  "hsl(200 80% 50%)",
  "hsl(142 70% 45%)",
  "hsl(280 55% 55%)",
  "hsl(16 75% 55%)",
  "hsl(330 60% 55%)",
];

interface RankedItem {
  id: string;
  name: string;
  valueLabel: string;
  subLabel: string;
  goalProgress: number;
  position: number;
  colorIdx: number;
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1).replace(".", ",")}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/**
 * Ranking do mês — pódio top 3 (líder elevado ao centro) + tabela do restante,
 * com toggle Vendas | Reuniões (metric_type sales/meetings do RankingTable legado).
 */
function RankingPodiumBase({ range, teamSalesTotal }: RankingPodiumProps) {
  const { data, isLoading } = useRankingData(undefined, undefined, range);
  const [mode, setMode] = useState<Mode>("vendas");

  const { ranked, totalLabel } = useMemo(() => {
    if (mode === "vendas") {
      const list = (data?.salesRanking ?? []).map((r, i): RankedItem => ({
        id: r.id,
        name: r.name ?? "Sem nome",
        valueLabel: formatK(r.value),
        subLabel: `${r.conversions} venda${r.conversions === 1 ? "" : "s"}`,
        goalProgress: Math.round(r.goalProgress),
        position: r.position,
        colorIdx: i % AV_COLORS.length,
      }));
      const total = (data?.salesRanking ?? []).reduce((acc, r) => acc + r.value, 0);
      return { ranked: list, totalLabel: `${formatK(total)} no time` };
    }
    // No meetingsRanking, `value` é placeholder (sempre 0 na RPC) — o dado real
    // é `meetings` (realizadas) e `meetingsBooked` (marcadas)
    const list = (data?.meetingsRanking ?? []).map((r, i): RankedItem => {
      const booked = r.meetingsBooked ?? 0;
      const goalBookedProgress = r.goalBookedProgress ?? 0;
      return {
        id: r.id,
        name: r.name ?? "Sem nome",
        valueLabel: `${r.meetings} realizada${r.meetings === 1 ? "" : "s"}`,
        subLabel: goalBookedProgress > 0
          ? `${booked} marcadas · ${goalBookedProgress}% da meta de marcadas`
          : `${booked} marcadas`,
        goalProgress: Math.round(r.goalProgress),
        position: r.position,
        colorIdx: i % AV_COLORS.length,
      };
    });
    const total = (data?.meetingsRanking ?? []).reduce((acc, r) => acc + r.meetings, 0);
    return { ranked: list, totalLabel: `${Math.round(total)} reuniões no time` };
  }, [data, mode]);

  // Vendas fechadas sem vendedor atribuído somem do ranking — avisar
  const unassignedSales = useMemo(() => {
    if (mode !== "vendas" || !teamSalesTotal) return 0;
    const rankedSum = (data?.salesRanking ?? []).reduce((acc, r) => acc + r.value, 0);
    const diff = teamSalesTotal - rankedSum;
    return diff > 1 ? diff : 0;
  }, [mode, teamSalesTotal, data]);

  // Pódio na ordem visual P2 · P1 · P3
  const podium = useMemo(() => {
    const top3 = ranked.slice(0, 3);
    if (top3.length < 3) return top3;
    return [top3[1], top3[0], top3[2]];
  }, [ranked]);
  const rest = ranked.slice(3);

  if (isLoading) {
    return <Skeleton className="h-[360px] rounded-2xl" />;
  }

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".1s" }}>
      <div className="mb-[18px] flex items-center justify-between">
        <span className="cmd-lbl">Ranking do mês</span>
        <div className="flex items-center gap-2.5">
          <div className="flex gap-[2px] rounded-[9px] border border-border bg-background p-[3px]">
            {(["vendas", "reunioes"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-3.5 py-[5px] text-[11.5px] font-bold transition-all",
                  mode === m
                    ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(47_70%_40%/.5)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "vendas" ? "Vendas" : "Reuniões"}
              </button>
            ))}
          </div>
          <span className="rounded-full bg-primary/15 px-[9px] py-[3px] text-[10.5px] font-extrabold text-primary tabular-nums">
            {totalLabel}
          </span>
        </div>
      </div>

      {unassignedSales > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-[hsl(36_80%_45%/.4)] bg-[hsl(36_80%_50%/.08)] px-3 py-2 text-[11.5px] text-muted-foreground">
          <b className="font-extrabold text-[hsl(36_85%_60%)]">{formatK(unassignedSales)} em vendas sem vendedor atribuído</b>
          <span>— atribua o vendedor nos cards do funil de fechamento pra contar no ranking.</span>
        </div>
      )}
      {ranked.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          Nenhum resultado no período ainda.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_1.25fr_1fr] items-end gap-3.5">
            {podium.map((p) => {
              const first = p.position === 1;
              return (
                <div
                  key={`${mode}-${p.id}`}
                  className={cn(
                    "cmd-rise rounded-2xl border bg-card p-[18px] text-center",
                    first
                      ? "border-[hsl(47_70%_40%/.5)] p-6 [background:linear-gradient(180deg,hsl(47_60%_16%/.5),hsl(var(--card))_55%)]"
                      : "border-border",
                  )}
                >
                  <span className={cn("cmd-mono text-[11px] font-extrabold tracking-[.15em]", first ? "text-primary" : "text-muted-foreground/60")}>
                    {first ? "P1 — LÍDER" : `P${p.position}`}
                  </span>
                  <div
                    className={cn(
                      "mx-auto mb-2 mt-2.5 flex items-center justify-center rounded-2xl font-extrabold text-background",
                      first
                        ? "h-16 w-16 text-[21px] shadow-[0_0_0_3px_hsl(var(--background)),0_0_0_5px_hsl(var(--primary)),0_8px_28px_hsl(var(--primary)/.3)]"
                        : "h-[52px] w-[52px] text-[17px]",
                    )}
                    style={{ background: AV_COLORS[p.colorIdx] }}
                  >
                    {initials(p.name)}
                  </div>
                  <div className="text-[13.5px] font-bold">{p.name}</div>
                  <div className={cn("mt-1 font-black tracking-[-0.03em] tabular-nums", first ? "text-[27px]" : "text-[22px]")}>
                    {p.valueLabel}
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground/60">{p.subLabel}</div>
                  <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-background">
                    <i
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(p.goalProgress, 100)}%`, background: BAR_COLORS[p.colorIdx] }}
                    />
                  </div>
                  <div className={cn("mt-[5px] text-[10.5px] font-bold", first ? "text-primary" : "text-muted-foreground")}>
                    {p.goalProgress}% da meta
                  </div>
                </div>
              );
            })}
          </div>

          {rest.length > 0 && (
            <table className="mt-1 w-full border-collapse">
              <tbody>
                {rest.map((r) => (
                  <tr key={`${mode}-${r.id}`}>
                    <td className="cmd-mono w-[30px] border-t border-border/70 py-[9px] pr-2 text-[11px] font-extrabold text-muted-foreground/60">
                      P{r.position}
                    </td>
                    <td className="border-t border-border/70 py-[9px]">
                      <span className="flex items-center gap-[9px] text-[12.5px] font-semibold">
                        <span
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[10px] font-extrabold text-background"
                          style={{ background: AV_COLORS[r.colorIdx] }}
                        >
                          {initials(r.name)}
                        </span>
                        {r.name}
                      </span>
                    </td>
                    <td className="border-t border-border/70 py-[9px] text-right text-[12.5px] font-bold tabular-nums">{r.valueLabel}</td>
                    <td className="border-t border-border/70 py-[9px] text-right text-[11px] text-muted-foreground/60">{r.subLabel}</td>
                    <td className="border-t border-border/70 py-[9px] text-right text-[11px] text-muted-foreground/60">{r.goalProgress}% da meta</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export const RankingPodium = memo(RankingPodiumBase);
