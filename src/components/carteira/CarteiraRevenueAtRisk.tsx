import { useRevenueAtRisk } from "@/hooks/useRevenueAtRisk";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

const WINDOWS = [
  { key: "7d" as const, label: "7 dias", accent: "text-[#ef4444]", bg: "bg-[#ef4444]" },
  { key: "14d" as const, label: "14 dias", accent: "text-[#f59e0b]", bg: "bg-[#f59e0b]" },
  { key: "30d" as const, label: "30 dias", accent: "text-[#3b82f6]", bg: "bg-[#3b82f6]" },
];

export function CarteiraRevenueAtRisk() {
  const { data, isLoading } = useRevenueAtRisk();

  if (isLoading) {
    return (
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-40 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-zinc-800 rounded" />
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
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
        <h3 className="text-sm font-semibold text-[#fafafa]">Receita em Risco</h3>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {WINDOWS.map((w) => {
          const win = data.windows[w.key];
          const barWidth = maxTotal > 0 ? (win.total / maxTotal) * 100 : 0;
          return (
            <div key={w.key} className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-medium text-[#71717a]">
                {w.label}
              </div>
              <div className={cn("text-xl font-bold tabular-nums", w.accent)}>
                {formatBRL(win.total)}
              </div>
              <div className="h-1.5 bg-[#27272a] rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", w.bg)}
                  style={{ width: `${barWidth}%`, opacity: 0.7 }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-[#71717a]">
                <span>{win.count} clientes</span>
                {win.ouro_total > 0 && (
                  <span className="text-[#eab308]">
                    {formatBRL(win.ouro_total)} ouro
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.top_risk_clients && data.top_risk_clients.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[#27272a]">
          <div className="text-[10px] uppercase tracking-wider font-medium text-[#71717a] mb-2">
            Clientes ouro em risco
          </div>
          <div className="space-y-1.5">
            {data.top_risk_clients.slice(0, 3).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-[#fafafa] truncate max-w-[160px]">{c.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[#a1a1aa] tabular-nums">{formatBRL(c.avg_ticket)}</span>
                  <span className="text-[#ef4444] tabular-nums font-medium">
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
