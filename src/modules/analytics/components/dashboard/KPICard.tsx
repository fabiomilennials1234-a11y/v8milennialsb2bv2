import { memo } from "react";
import { motion } from "framer-motion";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { useCountUp } from "@/shared/hooks/useCountUp";

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
      className="relative overflow-hidden rounded-card border border-card-border bg-card p-[18px] shadow-relevo transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-relevo-alto"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground/80">
            {title}
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <p className="text-[1.65rem] font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums">
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
        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] bg-muted">
          <Icon className="h-4 w-4 text-foreground/70" />
        </div>
      </div>
    </motion.div>
  );
}

export const KPICard = memo(KPICardBase);
