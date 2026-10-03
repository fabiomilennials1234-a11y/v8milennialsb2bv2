import type { ReactNode } from "react";
import { Crown } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface LeaderboardRow {
  id: string;
  name: string;
  /** 0–100 — largura da barra de conversão. */
  ratePct: number;
  /** Número principal à direita (ex.: "38 / 274 leads" ou "R$ 52.300"). */
  headline: ReactNode;
  /** Linha pequena sob o headline (ex.: "14% de agendamento"). */
  subline?: string;
  /** Linha de contexto sob o nome (ex.: "14 propostas · 6 vendas"). */
  context?: string;
  /** Pinta o headline de verde (valores em R$ fechados). */
  currency?: boolean;
}

interface MemberLeaderboardProps {
  rows: LeaderboardRow[];
  emptyLabel?: string;
}

/** Ranking de responsáveis — top 1 em gold, barra de conversão por pessoa. */
export function MemberLeaderboard({ rows, emptyLabel = "Nenhum responsável cadastrado" }: MemberLeaderboardProps) {
  if (rows.length === 0) {
    return <p className="text-center text-muted-foreground text-sm py-4">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col">
      {rows.map((row, i) => {
        const isTop = i === 0 && row.ratePct > 0;
        return (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="grid grid-cols-[26px_34px_1fr_auto] items-center gap-3.5 py-3 border-b border-border/40 last:border-b-0"
          >
            <span
              className={cn(
                "text-[11px] tabular-nums",
                isTop ? "text-primary font-extrabold text-[13px]" : "text-muted-foreground"
              )}
            >
              {i + 1}
            </span>
            <div
              className={cn(
                "w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-bold shrink-0",
                isTop
                  ? "bg-primary/15 text-primary border border-primary/40"
                  : "bg-muted text-foreground"
              )}
            >
              {isTop ? <Crown className="w-4 h-4" /> : row.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold truncate">{row.name}</p>
              {row.context && (
                <p className="text-[10.5px] text-muted-foreground mt-0.5 truncate">{row.context}</p>
              )}
              <div className="h-[5px] rounded-full bg-muted mt-1.5 overflow-hidden">
                <motion.div
                  className={cn(
                    "h-full rounded-full",
                    row.currency
                      ? "bg-gradient-to-r from-success/50 to-success"
                      : "bg-gradient-to-r from-primary/50 to-primary"
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(row.ratePct, 100)}%` }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={cn("text-base font-bold tabular-nums", row.currency && "text-success")}>
                {row.headline}
              </p>
              {row.subline && (
                <p className="text-[10.5px] text-muted-foreground mt-0.5">{row.subline}</p>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
