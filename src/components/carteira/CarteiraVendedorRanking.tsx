import { useVendedorRanking, type VendedorStats } from "@/hooks/useVendedorRanking";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Crown, TrendingUp, Users } from "lucide-react";

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function healthBadge(score: number) {
  if (score >= 80) return { label: `${score}`, className: "bg-emerald-500/20 text-emerald-400" };
  if (score >= 60) return { label: `${score}`, className: "bg-amber-500/20 text-amber-400" };
  return { label: `${score}`, className: "bg-red-500/20 text-red-400" };
}

interface CarteiraVendedorRankingProps {
  onFilterByVendedor?: (closerId: string | null) => void;
}

export function CarteiraVendedorRanking({ onFilterByVendedor }: CarteiraVendedorRankingProps) {
  const { data: vendedores = [], isLoading } = useVendedorRanking();

  if (isLoading) {
    return (
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-zinc-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (vendedores.length === 0) {
    return (
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 text-center text-sm text-[#71717a]">
        Nenhum vendedor com clientes atribuídos.
      </div>
    );
  }

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Crown className="w-4 h-4 text-[#eab308]" />
        <h3 className="text-sm font-semibold text-[#fafafa]">Ranking Vendedores</h3>
      </div>

      <div className="space-y-2">
        {vendedores.map((v, idx) => {
          const badge = healthBadge(v.avg_health);
          return (
            <button
              key={v.closer_id}
              onClick={() => onFilterByVendedor?.(v.closer_id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-[#27272a] hover:border-[#3f3f46] hover:bg-[#1c1c1f] transition-colors text-left"
            >
              {/* Rank + Avatar */}
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-xs font-bold text-[#52525b] w-4 text-right tabular-nums">
                  {idx + 1}
                </span>
                <div className="w-8 h-8 rounded-full bg-[#27272a] flex items-center justify-center text-xs font-bold text-[#a1a1aa]">
                  {initials(v.name)}
                </div>
              </div>

              {/* Name + role */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#fafafa] truncate">{v.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[#71717a]">
                    <Users className="w-3 h-3 inline mr-0.5" />
                    {v.total_clients}
                  </span>
                  {v.segments.ouro > 0 && (
                    <span className="text-[10px] text-[#eab308]">
                      {v.segments.ouro} ouro
                    </span>
                  )}
                </div>
              </div>

              {/* Metrics */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs text-[#a1a1aa]">Ticket</div>
                  <div className="text-xs font-semibold text-[#fafafa] tabular-nums">
                    {formatBRL(v.avg_ticket)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#a1a1aa]">No prazo</div>
                  <div className={cn(
                    "text-xs font-semibold tabular-nums",
                    v.on_time_pct != null && v.on_time_pct >= 70 ? "text-emerald-400" : "text-[#f59e0b]",
                  )}>
                    {v.on_time_pct != null ? `${v.on_time_pct}%` : "—"}
                  </div>
                </div>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums",
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
