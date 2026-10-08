import { useMemo, useState } from "react";
import { useCohortAnalysis, type CohortRow } from "@/modules/analytics/hooks/useCohortAnalysis";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Mesmas cinco faixas de antes (80/60/40/20/>0), em token. A letra fica na cor
 * do texto do tema: as faixas são preenchimento translúcido sobre o cartão, e
 * texto colorido em cima de fundo da mesma cor reprovava contraste no claro.
 */
function heatColor(pct: number): string {
  if (pct >= 80) return "bg-success/60 text-foreground";
  if (pct >= 60) return "bg-success/30 text-foreground";
  if (pct >= 40) return "bg-warning/35 text-foreground";
  if (pct >= 20) return "bg-destructive/25 text-foreground";
  if (pct > 0) return "bg-destructive/45 text-foreground";
  return "bg-muted/60 text-muted-foreground";
}

function formatMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

export function CarteiraCohortHeatmap() {
  const [segment, setSegment] = useState<string>("all");
  const { data: rows = [], isLoading } = useCohortAnalysis(
    segment && segment !== "all" ? { segment } : undefined,
  );

  const { cohorts, maxOffset } = useMemo(() => {
    const map = new Map<string, Map<number, CohortRow>>();
    let max = 0;
    for (const r of rows) {
      if (!map.has(r.cohort_month)) map.set(r.cohort_month, new Map());
      map.get(r.cohort_month)!.set(r.month_offset, r);
      if (r.month_offset > max) max = r.month_offset;
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    return { cohorts: sorted, maxOffset: Math.min(max, 11) };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-card border border-card-border bg-card p-5 shadow-relevo">
        <div className="mb-4 h-4 w-40 rounded bg-muted" />
        <div className="h-48 rounded-xl bg-muted" />
      </div>
    );
  }

  if (cohorts.length === 0) {
    return (
      <div className="rounded-card border border-card-border bg-card p-8 text-center text-sm text-muted-foreground shadow-relevo">
        Dados insuficientes para análise de coorte.
      </div>
    );
  }

  return (
    <section className="rounded-card border border-card-border bg-card p-5 shadow-relevo">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-[-0.02em] text-foreground">Retenção por coorte</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            % de clientes que compraram novamente no mês N após a primeira compra
          </p>
        </div>
        <Select value={segment} onValueChange={setSegment}>
          <SelectTrigger className="h-9 w-[170px] text-xs" aria-label="Segmento">
            <SelectValue placeholder="Todos segmentos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos segmentos</SelectItem>
            <SelectItem value="ouro">Ouro</SelectItem>
            <SelectItem value="prata">Prata</SelectItem>
            <SelectItem value="novo">Novo</SelectItem>
            <SelectItem value="resgate">Resgate</SelectItem>
            <SelectItem value="dormindo">Dormindo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="whitespace-nowrap py-1 pr-3 text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                Coorte
              </th>
              {Array.from({ length: maxOffset + 1 }, (_, i) => (
                <th
                  key={i}
                  className="min-w-[44px] px-1 py-1.5 text-center text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground"
                >
                  M{i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.slice(-12).map(([month, offsets]) => {
              const base = offsets.get(0);
              return (
                <tr key={month}>
                  <td className="whitespace-nowrap py-0.5 pr-3 font-semibold capitalize text-foreground/80">
                    {formatMonth(month)}
                    {base && (
                      <span className="ml-1 font-normal tabular-nums text-muted-foreground">({base.total_clients})</span>
                    )}
                  </td>
                  {Array.from({ length: maxOffset + 1 }, (_, i) => {
                    const cell = offsets.get(i);
                    if (!cell) {
                      return (
                        <td key={i} className="p-0.5">
                          <div className="h-8 w-full rounded-lg border border-dashed border-border/60" />
                        </td>
                      );
                    }
                    return (
                      <td key={i} className="p-0.5">
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "flex h-8 w-full cursor-default items-center justify-center rounded-lg text-[10.5px] font-bold tabular-nums transition-colors",
                                  heatColor(cell.retention_pct),
                                )}
                              >
                                {cell.retention_pct}%
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p>{cell.active_clients}/{cell.total_clients} clientes ativos</p>
                              <p className="text-tinta-muted">{formatMonth(month)} — M{i}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span>Baixa</span>
        <div className="flex gap-0.5">
          {[10, 30, 50, 70, 90].map((p) => (
            <div key={p} className={cn("h-3 w-5 rounded-[4px]", heatColor(p))} />
          ))}
        </div>
        <span>Alta retenção</span>
      </div>
    </section>
  );
}
