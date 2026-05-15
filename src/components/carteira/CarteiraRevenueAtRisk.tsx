import { useRevenueAtRisk } from "@/hooks/useRevenueAtRisk";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

const WINDOWS = [
  { key: "7d" as const, label: "7 dias", accent: "text-destructive", bg: "bg-red-500" },
  { key: "14d" as const, label: "14 dias", accent: "text-amber-500", bg: "bg-amber-500" },
  { key: "30d" as const, label: "30 dias", accent: "text-[#3b82f6]", bg: "bg-[#3b82f6]" },
];

export function CarteiraRevenueAtRisk() {
  const { data, isLoading } = useRevenueAtRisk();

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-40 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxTotal = Math.max(
    data.windows["7d"].total,
    data.windows["14d"].total,
    data.windows["30d"].total,
    1,
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-foreground">Receita em Risco</h3>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {WINDOWS.map((w) => {
          const win = data.windows[w.key];
          const barWidth = maxTotal > 0 ? (win.total / maxTotal) * 100 : 0;
          return (
            <div key={w.key} className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                {w.label}
              </div>
              <div className={cn("text-xl font-bold tabular-nums", w.accent)}>
                {formatBRL(win.total)}
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", w.bg)}
                  style={{ width: `${barWidth}%`, opacity: 0.7 }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{win.count} clientes</span>
                {win.ouro_total > 0 && (
                  <span className="text-primary">
                    {formatBRL(win.ouro_total)} ouro
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.top_risk_clients && data.top_risk_clients.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
            Clientes ouro em risco
          </div>
          <div className="space-y-1.5">
            {data.top_risk_clients.slice(0, 3).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-foreground truncate max-w-[160px]">{c.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums">{formatBRL(c.avg_ticket)}</span>
                  <span className="text-destructive tabular-nums font-medium">
                    {c.churn_probability}% churn
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
