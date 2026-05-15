import { useMemo, useState } from "react";
import { useCohortAnalysis, type CohortRow } from "@/hooks/useCohortAnalysis";
import { cn } from "@/lib/utils";

function heatColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500/70 text-emerald-100";
  if (pct >= 60) return "bg-emerald-500/40 text-emerald-200";
  if (pct >= 40) return "bg-amber-500/40 text-amber-200";
  if (pct >= 20) return "bg-red-500/30 text-red-300";
  if (pct > 0) return "bg-red-500/50 text-red-200";
  return "bg-muted/50 text-zinc-600";
}

function formatMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

export function CarteiraCohortHeatmap() {
  const [segment, setSegment] = useState<string>("");
  const { data: rows = [], isLoading } = useCohortAnalysis(
    segment ? { segment } : undefined,
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
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-40 mb-4" />
        <div className="h-48 bg-muted rounded" />
      </div>
    );
  }

  if (cohorts.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 text-center text-sm text-muted-foreground">
        Dados insuficientes para análise de coorte.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Retenção por Coorte</h3>
        <select
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          className="bg-background border border-border rounded-md px-2 py-1 text-xs text-muted-foreground"
        >
          <option value="">Todos segmentos</option>
          <option value="ouro">Ouro</option>
          <option value="prata">Prata</option>
          <option value="novo">Novo</option>
          <option value="resgate">Resgate</option>
          <option value="dormindo">Dormindo</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-medium py-1 pr-3 whitespace-nowrap">
                Coorte
              </th>
              {Array.from({ length: maxOffset + 1 }, (_, i) => (
                <th
                  key={i}
                  className="text-center text-muted-foreground font-medium py-1 px-1 min-w-[36px]"
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
                  <td className="text-muted-foreground py-0.5 pr-3 whitespace-nowrap">
                    {formatMonth(month)}
                    {base && (
                      <span className="text-muted-foreground/60 ml-1">({base.total_clients})</span>
                    )}
                  </td>
                  {Array.from({ length: maxOffset + 1 }, (_, i) => {
                    const cell = offsets.get(i);
                    if (!cell) {
                      return <td key={i} className="p-0.5"><div className="w-full h-6" /></td>;
                    }
                    return (
                      <td key={i} className="p-0.5">
                        <div
                          className={cn(
                            "w-full h-6 rounded flex items-center justify-center text-[10px] font-medium tabular-nums",
                            heatColor(cell.retention_pct),
                          )}
                          title={`${cell.active_clients}/${cell.total_clients} clientes (${cell.retention_pct}%)`}
                        >
                          {cell.retention_pct}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
        <span>Baixa</span>
        <div className="flex gap-0.5">
          {[10, 30, 50, 70, 90].map((p) => (
            <div key={p} className={cn("w-5 h-3 rounded-sm", heatColor(p))} />
          ))}
        </div>
        <span>Alta retenção</span>
      </div>
    </div>
  );
}
