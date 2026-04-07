import { memo } from "react";
import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OriginMetrics } from "@/hooks/useMktByOrigin";
import { ORIGIN_LABELS, ORIGIN_COLORS, type LeadOrigin } from "@/hooks/useMktOriginConfig";

const POSITION_ICONS = [Crown, Medal, Award] as const;
const POSITION_BG = ["bg-yellow-500/10", "bg-slate-400/10", "bg-amber-600/10"];
const POSITION_ICON_BG = ["bg-yellow-500", "bg-slate-400", "bg-amber-600"];

interface MktOriginRankingProps {
  origins: OriginMetrics[];
}

function MktOriginRankingBase({ origins }: MktOriginRankingProps) {
  if (origins.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-5">
        <p className="stat-card-label flex items-center gap-1.5 mb-4">
          <Trophy className="w-3.5 h-3.5 text-primary/60" />
          Ranking de Origens
        </p>
        <p className="text-xs text-muted-foreground/50 text-center py-6">Sem dados de origens</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <p className="stat-card-label flex items-center gap-1.5 mb-4">
        <Trophy className="w-3.5 h-3.5 text-primary/60" />
        Ranking de Origens
      </p>

      <div className="flex flex-col gap-1.5">
        {origins.map((origin, index) => {
          const key = origin.origin as LeadOrigin;
          const label = ORIGIN_LABELS[key] ?? key;
          const color = ORIGIN_COLORS[key] ?? "#64748B";
          const Icon = index < 3 ? POSITION_ICONS[index] : null;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.07 }}
              className={cn(
                "relative flex items-center gap-2.5 p-2.5 rounded-lg overflow-hidden",
                index < 3 ? POSITION_BG[index] : ""
              )}
            >
              {/* Shimmer for #1 */}
              {index === 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-0 left-[-100%] w-1/2 h-full bg-gradient-to-r from-transparent via-yellow-500/[0.04] to-transparent animate-[shimmer_4s_ease-in-out_infinite]" />
                </div>
              )}

              {/* Rank badge */}
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                  index < 3 ? POSITION_ICON_BG[index] : "bg-muted"
                )}
              >
                {Icon ? (
                  <Icon className="w-3.5 h-3.5 text-white" />
                ) : (
                  <span className="text-[10px] font-bold text-muted-foreground">{index + 1}</span>
                )}
              </div>

              {/* Origin */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[13px] font-medium truncate">{label}</span>
              </div>

              {/* Metrics */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-[13px] font-bold tabular-nums text-success">
                    {origin.conversionRate.toFixed(1)}%
                  </p>
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-[0.05em]">
                    Conversão
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-bold tabular-nums">{origin.leadsCount}</p>
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-[0.05em]">
                    Leads
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export const MktOriginRanking = memo(MktOriginRankingBase);
