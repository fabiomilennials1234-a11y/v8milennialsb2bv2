import { memo, useMemo } from "react";
import { Inbox, MessageSquare, Calendar, FileText, DollarSign, type LucideIcon } from "lucide-react";
import { useSalesCycleAnalysis } from "@/modules/analytics/hooks/useAnalytics";
import { Skeleton } from "@/components/ui/skeleton";

interface LeadJourneyProps {
  startDate: string;
  endDate: string;
  /** Vendas fechadas no período — exibido na etapa final. */
  totalSales: number;
}

interface JourneyStep {
  label: string;
  days: number | null;
}

const STAGES: Array<{ label: string; icon: LucideIcon; sub?: string }> = [
  { label: "Lead chega", icon: Inbox },
  { label: "Primeiro contato", icon: MessageSquare },
  { label: "Reunião", icon: Calendar },
  { label: "Proposta enviada", icon: FileText },
  { label: "Venda fechada", icon: DollarSign },
];

// Transições do pipe whatsapp/propostas → posições da jornada
const TRANSITION_SLOT: Record<string, number> = {
  "novo_lead>abordado": 0,
  "novo_lead>respondeu": 0,
  "abordado>respondeu": 1,
  "abordado>agendado": 1,
  "respondeu>agendado": 1,
  "agendado>enviada": 2,
  "compareceu>enviada": 2,
  "enviada>vendido": 3,
  "negociacao>vendido": 3,
};

function fmtDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  const label = rounded.toFixed(1).replace(".", ",").replace(",0", "");
  return `${label} dia${rounded >= 2 ? "s" : ""}`;
}

/**
 * Jornada do lead — timeline vertical com tempo médio entre etapas
 * (fonte: get_sales_cycle_analysis, pipes whatsapp + propostas), barras
 * proporcionais e tag rápido/normal/gargalo relativa ao período.
 */
function LeadJourneyBase({ startDate, endDate, totalSales }: LeadJourneyProps) {
  const { data: whatsappCycle, isLoading: l1 } = useSalesCycleAnalysis("whatsapp", startDate, endDate);
  const { data: propostasCycle, isLoading: l2 } = useSalesCycleAnalysis("propostas", startDate, endDate);

  const { steps, totalDays, maxDays } = useMemo(() => {
    const slots: Array<{ hours: number; count: number }> = [
      { hours: 0, count: 0 }, { hours: 0, count: 0 }, { hours: 0, count: 0 }, { hours: 0, count: 0 },
    ];
    for (const t of [...(whatsappCycle ?? []), ...(propostasCycle ?? [])]) {
      const slot = TRANSITION_SLOT[`${t.from_stage}>${t.to_stage}`];
      if (slot === undefined || !t.transition_count) continue;
      slots[slot].hours += t.avg_hours * t.transition_count;
      slots[slot].count += t.transition_count;
    }
    const steps: JourneyStep[] = slots.map((s, i) => ({
      label: STAGES[i].label,
      days: s.count > 0 ? s.hours / s.count / 24 : null,
    }));
    const known = steps.filter((s) => s.days !== null) as Array<{ label: string; days: number }>;
    const totalDays = known.reduce((acc, s) => acc + s.days, 0);
    const maxDays = known.length ? Math.max(...known.map((s) => s.days)) : 0;
    return { steps, totalDays, maxDays };
  }, [whatsappCycle, propostasCycle]);

  if (l1 || l2) {
    return <Skeleton className="h-[400px] rounded-2xl" />;
  }

  const hasData = steps.some((s) => s.days !== null);

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".25s" }}>
      <span className="cmd-lbl">Jornada do lead — tempo até a venda</span>
      <div className="mt-1 text-[11px] font-semibold text-muted-foreground/60">
        quantos dias o lead leva, em média, pra avançar de etapa
      </div>

      {!hasData ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          Sem movimentações suficientes no período pra medir a jornada.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col">
            {STAGES.map((stage, i) => {
              const Icon = stage.icon;
              const isLast = i === STAGES.length - 1;
              const gap = i < steps.length ? steps[i] : null;
              const isSlowest = gap?.days !== null && gap !== null && maxDays > 0 && gap.days === maxDays;
              const tag = gap?.days === null || gap === null
                ? null
                : isSlowest
                  ? { text: "gargalo", cls: "text-[hsl(0_70%_62%)] bg-destructive/10" }
                  : gap.days <= maxDays * 0.25
                    ? { text: "rápido", cls: "text-success bg-success/10" }
                    : { text: "normal", cls: "text-muted-foreground bg-background" };
              return (
                <div key={stage.label} className="contents">
                  <div className="grid grid-cols-[38px_1fr] items-center gap-3">
                    <span
                      className={`flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 ${
                        isLast ? "border-success bg-success/10 text-success" : "border-primary bg-primary/15 text-primary"
                      }`}
                    >
                      <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
                    </span>
                    <span className="text-[13px] font-bold">
                      {stage.label}
                      {isLast && totalSales > 0 && (
                        <small className="mt-[1px] block text-[10.5px] font-semibold text-muted-foreground/60">
                          {totalSales} venda{totalSales === 1 ? "" : "s"} no período
                        </small>
                      )}
                    </span>
                  </div>
                  {!isLast && (
                    <div className="grid min-h-[44px] grid-cols-[38px_1fr] items-center gap-3">
                      <span className="relative mx-auto my-1 h-full min-h-[36px] w-[3px] overflow-hidden rounded-sm bg-border/70">
                        <i className={`absolute inset-0 ${isSlowest ? "bg-[hsl(0_62%_52%)]" : "bg-primary"}`} />
                      </span>
                      {gap?.days !== null && gap !== null ? (
                        <span className="flex items-center gap-2.5">
                          <span className={`w-16 flex-none text-[13px] font-extrabold tabular-nums ${isSlowest ? "text-[hsl(0_70%_62%)]" : ""}`}>
                            {fmtDays(gap.days)}
                          </span>
                          <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-background">
                            <i
                              className="block h-full rounded-full"
                              style={{
                                width: `${maxDays > 0 ? Math.max((gap.days / maxDays) * 100, 6) : 0}%`,
                                background: isSlowest ? "hsl(0 62% 52% / .8)" : "hsl(47 100% 50% / .65)",
                              }}
                            />
                          </span>
                          {tag && (
                            <span className={`flex-none rounded-full px-2 py-[2px] text-[10px] font-extrabold uppercase tracking-[.05em] ${tag.cls}`}>
                              {tag.text}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-muted-foreground/50">sem dados no período</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-[11px] border border-border/70 bg-card px-3.5 py-[11px]">
            <span className="text-[11.5px] font-semibold text-muted-foreground">
              Do lead à venda: <b className="font-extrabold text-foreground">{fmtDays(totalDays)}</b> em média
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export const LeadJourney = memo(LeadJourneyBase);
