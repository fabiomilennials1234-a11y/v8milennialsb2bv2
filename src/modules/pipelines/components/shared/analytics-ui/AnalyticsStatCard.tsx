import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const ACCENT_LINE: Record<string, string> = {
  gold: "via-primary",
  success: "via-success",
  blue: "via-chart-5",
  neutral: "via-foreground/50",
};

const ACCENT_VALUE: Record<string, string> = {
  gold: "text-primary",
  success: "text-success",
  blue: "text-foreground",
  neutral: "text-foreground",
};

interface AnalyticsStatCardProps {
  label: string;
  value: ReactNode;
  /** Contexto computável: "61% do total", "11 propostas"... */
  sub?: ReactNode;
  accent?: keyof typeof ACCENT_LINE;
  /** Tinge o número com a cor do accent (default: só a linha do topo). */
  tintValue?: boolean;
  onClick?: () => void;
  delay?: number;
  className?: string;
}

/** Stat card dos analytics de funil — linha de accent no topo + número tabular. */
export function AnalyticsStatCard({
  label,
  value,
  sub,
  accent = "neutral",
  tintValue = false,
  onClick,
  delay = 0,
  className,
}: AnalyticsStatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-card to-card/70 p-4 pt-[18px]",
        onClick && "cursor-pointer transition-all hover:ring-1 hover:ring-primary/30",
        className
      )}
    >
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent to-transparent opacity-80",
          ACCENT_LINE[accent]
        )}
      />
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums tracking-tight mt-2 whitespace-nowrap",
          tintValue && ACCENT_VALUE[accent]
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>}
    </motion.div>
  );
}
