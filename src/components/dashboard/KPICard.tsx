import { memo } from "react";
import { motion } from "framer-motion";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { useCountUp } from "@/hooks/useCountUp";

interface KPICardProps {
  title: string;
  value: number;
  format?: "currency" | "number" | "percent" | "hours" | "minutes";
  icon: LucideIcon;
  trend?: { value: number; isPositive: boolean };
  delay?: number;
}

function formatValue(value: number, format: string): string {
  switch (format) {
    case "currency":
      if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
      if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
      return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
    case "percent":
      return `${Math.round(value)}%`;
    case "hours":
      return `${value.toFixed(1)}h`;
    case "minutes":
      if (value >= 60) return `${(value / 60).toFixed(1)}h`;
      return `${Math.round(value)}min`;
    default:
      return Math.round(value).toLocaleString("pt-BR");
  }
}

function KPICardBase({ title, value, format = "number", icon: Icon, trend, delay = 0 }: KPICardProps) {
  const animated = useCountUp(value, 1200, true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="relative bg-card rounded-lg border border-border p-5 hover:border-border/80 transition-colors overflow-hidden group"
    >
      {/* Accent bar — racing stripe */}
      <div className="absolute left-0 top-0 w-[3px] h-full bg-primary/60 group-hover:bg-primary transition-colors" />

      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {title}
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <p className="text-2xl font-extrabold tracking-[-0.03em] tabular-nums">
              {formatValue(animated, format)}
            </p>
            {trend && (
              <span className={`flex items-center text-[11px] font-semibold tabular-nums ${trend.isPositive ? "text-success" : "text-destructive"}`}>
                {trend.isPositive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                {Math.abs(trend.value)}%
              </span>
            )}
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-muted">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    </motion.div>
  );
}

export const KPICard = memo(KPICardBase);
