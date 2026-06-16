import { memo, useMemo } from "react";
import { Inbox, MessageSquare, Calendar, FileText, DollarSign, type LucideIcon } from "lucide-react";
import { useSalesCycleAnalysis } from "@/modules/analytics/hooks/useAnalytics";
import { Skeleton } from "@/components/ui/skeleton";

interface LeadJourneyProps {
  startDate: string;
  endDate: string;
  /** Vendas fechadas no período — exibido quando a etapa final é de fechamento. */
  totalSales: number;
}

interface Transition {
  from_stage: string;
  to_stage: string;
  avg_hours: number;
  transition_count: number;
}

// Ícones por posição na cadeia (visual aprovado) — etapas são dinâmicas por org
const STEP_ICONS: LucideIcon[] = [Inbox, MessageSquare, Calendar, FileText, DollarSign];
const MAX_HOPS = 4;

function fmtDays(hours: number): string {
  const days = hours / 24;
  if (days < 1) {
    const h = Math.max(Math.round(hours), 1);
    return `${h}h`;
  }
  const rounded = Math.round(days * 10) / 10;
  const label = rounded.toFixed(1).replace(".", ",").replace(",0", "");
  return `${label} dia${rounded >= 2 ? "s" : ""}`;
}

/**
 * Encadeia as transições mais frequentes num caminho dominante:
 * começa na transição de maior volume cujo `from` não é destino de ninguém
 * (entrada do funil) e segue greedy pelo próximo `from === to` de maior volume.
 */
function buildChain(transitions: Transition[]): Transition[] {
  if (transitions.length === 0) return [];
  const destinations = new Set(transitions.map((t) => t.to_stage));
  const sorted = [...transitions].sort((a, b) => b.transition_count - a.transition_count);
  const start = sorted.find((t) => !destinations.has(t.from_stage)) ?? sorted[0];

  const chain: Transition[] = [start];
  const visited = new Set([start.from_stage, start.to_stage]);
  while (chain.length < MAX_HOPS) {
    const last = chain[chain.length - 1];
    const next = sorted.find((t) => t.from_stage === last.to_stage && !visited.has(t.to_stage));
    if (!next) break;
    chain.push(next);
    visited.add(next.to_stage);
  }
  return chain;
}

const CLOSING_RE = /vend|fech|ganh|contrat/i;

/**
 * Jornada do lead — timeline vertical com o caminho dominante REAL da org
 * (etapas dinâmicas, labels do funil do cliente) e tempo médio entre etapas.
 * Fonte: get_sales_cycle_analysis v2 (deriva transições do lead_history).
 */
function LeadJourneyBase({ startDate, endDate, totalSales }: LeadJourneyProps) {
  // Sem filtro de pipe: a jornada cruza funis (whatsapp → propostas)
  const { data: transitions, isLoading } = useSalesCycleAnalysis(undefined, startDate, endDate);

  const { chain, maxHours, totalHours } = useMemo(() => {
    const chain = buildChain((transitions ?? []) as Transition[]);
    const maxHours = chain.length ? Math.max(...chain.map((t) => t.avg_hours)) : 0;
    const totalHours = chain.reduce((acc, t) => acc + t.avg_hours, 0);
    return { chain, maxHours, totalHours };
  }, [transitions]);

  if (isLoading) {
    return <Skeleton className="h-[400px] rounded-2xl" />;
  }

  // Etapas = from da 1ª transição + to de cada transição da cadeia
  const stages = chain.length
    ? [chain[0].from_stage, ...chain.map((t) => t.to_stage)]
    : [];

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".25s" }}>
      <span className="cmd-lbl">Jornada do lead — tempo entre etapas</span>
      <div className="mt-1 text-[11px] font-semibold text-muted-foreground/60">
        caminho mais percorrido no funil e quantos dias o lead leva em cada passo
      </div>

      {chain.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          Sem movimentações suficientes no período pra medir a jornada.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col">
            {stages.map((label, i) => {
              const Icon = STEP_ICONS[Math.min(i, STEP_ICONS.length - 1)];
              const isLast = i === stages.length - 1;
              const isClosing = isLast && CLOSING_RE.test(label);
              const gap = i < chain.length ? chain[i] : null;
              const isSlowest = gap !== null && maxHours > 0 && gap.avg_hours === maxHours && chain.length > 1;
              const tag = gap === null
                ? null
                : isSlowest
                  ? { text: "gargalo", cls: "text-[hsl(0_70%_62%)] bg-destructive/10" }
                  : gap.avg_hours <= maxHours * 0.25
                    ? { text: "rápido", cls: "text-success bg-success/10" }
                    : { text: "normal", cls: "text-muted-foreground bg-background" };
              return (
                <div key={`${label}-${i}`} className="contents">
                  <div className="grid grid-cols-[38px_1fr] items-center gap-3">
                    <span
                      className={`flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 ${
                        isClosing ? "border-success bg-success/10 text-success" : "border-primary bg-primary/15 text-primary"
                      }`}
                    >
                      <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
                    </span>
                    <span className="truncate text-[13px] font-bold" title={label}>
                      {label}
                      {isClosing && totalSales > 0 && (
                        <small className="mt-[1px] block text-[10.5px] font-semibold text-muted-foreground/60">
                          {totalSales} venda{totalSales === 1 ? "" : "s"} no período
                        </small>
                      )}
                    </span>
                  </div>
                  {gap !== null && (
                    <div className="grid min-h-[44px] grid-cols-[38px_1fr] items-center gap-3">
                      <span className="relative mx-auto my-1 h-full min-h-[36px] w-[3px] overflow-hidden rounded-sm bg-border/70">
                        <i className={`absolute inset-0 ${isSlowest ? "bg-[hsl(0_62%_52%)]" : "bg-primary"}`} />
                      </span>
                      <span className="flex items-center gap-2.5">
                        <span className={`w-16 flex-none text-[13px] font-extrabold tabular-nums ${isSlowest ? "text-[hsl(0_70%_62%)]" : ""}`}>
                          {fmtDays(gap.avg_hours)}
                        </span>
                        <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-background">
                          <i
                            className="block h-full rounded-full"
                            style={{
                              width: `${maxHours > 0 ? Math.max((gap.avg_hours / maxHours) * 100, 6) : 0}%`,
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-[11px] border border-border/70 bg-card px-3.5 py-[11px]">
            <span className="text-[11.5px] font-semibold text-muted-foreground">
              Caminho completo: <b className="font-extrabold text-foreground">{fmtDays(totalHours)}</b> em média
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export const LeadJourney = memo(LeadJourneyBase);
