import { memo, useMemo } from "react";
import { useWinLossAnalysis } from "@/modules/analytics/hooks/useAnalytics";
import { Skeleton } from "@/components/ui/skeleton";

interface LossReasonsCardProps {
  startDate: string;
  endDate: string;
  /** Vendas fechadas no período (lado "ganho" do placar). */
  totalWon: number;
}

const REASON_LABELS: Record<string, string> = {
  sem_budget: "Sem orçamento",
  concorrencia: "Concorrente direto",
  timing: "Timing errado",
  follow_up_fraco: "Lead esfriou",
  produto_nao_adequado: "Produto não adequado",
  outro: "Outro motivo",
};

/**
 * Ganho vs perda — placar do período + motivos de perda em barras com leitura
 * do maior ofensor. Substitui o WinLossAnalysis (donut) por leitura direta.
 */
function LossReasonsCardBase({ startDate, endDate, totalWon }: LossReasonsCardProps) {
  const { data: losses, isLoading } = useWinLossAnalysis(startDate, endDate);

  const { rows, totalLost, topReason } = useMemo(() => {
    const list = (losses ?? [])
      .map((l) => ({ ...l, label: REASON_LABELS[l.loss_reason] ?? l.loss_reason }))
      .sort((a, b) => b.count - a.count);
    const totalLost = list.reduce((acc, l) => acc + l.count, 0);
    const max = list[0]?.count ?? 0;
    return {
      rows: list.slice(0, 4).map((l) => ({ ...l, pct: max > 0 ? (l.count / max) * 100 : 0 })),
      totalLost,
      topReason: list[0]?.label ?? null,
    };
  }, [losses]);

  if (isLoading) {
    return <Skeleton className="h-[280px] rounded-2xl" />;
  }

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".3s" }}>
      <span className="cmd-lbl">Ganho vs perda</span>
      <div className="mt-2.5 text-center">
        <span className="text-[26px] font-black tracking-[-0.03em] tabular-nums">
          {totalWon}
          <span className="text-[15px] text-muted-foreground/50"> / </span>
          <span className="text-destructive">{totalLost}</span>
        </span>
        <div className="text-[10.5px] font-semibold text-muted-foreground/60">fechadas vs perdidas</div>
      </div>

      <div className="mt-3.5 flex flex-col gap-2.5">
        {rows.length === 0 && (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Nenhuma perda registrada no período.</p>
        )}
        {rows.map((l) => (
          <div key={l.loss_reason}>
            <div className="mb-[5px] flex justify-between text-[11.5px]">
              <b className="font-bold">{l.label}</b>
              <span className="font-extrabold text-destructive tabular-nums">
                {l.count} perda{l.count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="h-[5px] overflow-hidden rounded-full bg-background">
              <i className="block h-full rounded-full bg-[hsl(0_62%_52%/.8)]" style={{ width: `${l.pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      {topReason && (
        <div className="mt-3.5 text-center text-[11px] font-semibold text-muted-foreground/60">
          maior causa de perda: <b className="font-extrabold text-destructive">{topReason}</b>
        </div>
      )}
    </div>
  );
}

export const LossReasonsCard = memo(LossReasonsCardBase);
