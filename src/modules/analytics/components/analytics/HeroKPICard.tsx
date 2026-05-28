import { memo } from "react";
import { motion } from "framer-motion";
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { useCountUp } from "@/shared/hooks/useCountUp";
import { AT, ACCENT, type AccentColor } from "./analytics-tokens";

interface HeroKPICardProps {
  title: string;
  value: number;
  format?: "currency" | "number" | "percent" | "hours" | "minutes";
  icon: LucideIcon;
  trend?: { value: number; isPositive: boolean };
  accentColor: AccentColor;
  delay?: number;
}

function formatValue(value: number, format: string): string {
  switch (format) {
    case "currency":
      if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
      if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
      return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "hours":
      return `${value.toFixed(1)}h`;
    case "minutes":
      if (value >= 60) return `${(value / 60).toFixed(1)}h`;
      return `${Math.round(value)}min`;
    default:
      return Math.round(value).toLocaleString("pt-BR");
  }
}

function HeroKPICardBase({ title, value, format = "number", icon: Icon, trend, accentColor, delay = 0 }: HeroKPICardProps) {
  const animated = useCountUp(value, 1200, true);
  const accent = ACCENT[accentColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="relative bg-card rounded-lg border border-border p-6 hover:border-border/80 transition-colors overflow-hidden group"
    >
      {/* Gradient glow at bottom */}
      <div className={`absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t ${accent.gradient} pointer-events-none`} />

      <div className="relative flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className={AT.metricLabel}>
            {title}
          </p>
          <div className="flex items-baseline gap-2 mt-2">
            <p className={AT.valueLg}>
              {formatValue(animated, format)}
            </p>
          </div>
          {trend && (
            <span className={`flex items-center text-[11px] font-semibold tabular-nums mt-1.5 ${trend.isPositive ? "text-success" : "text-destructive"}`}>
              {trend.isPositive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
              {Math.abs(trend.value)}% vs anterior
            </span>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${accent.iconBg}`}>
          <Icon className={`w-4 h-4 ${accent.iconText}`} />
        </div>
      </div>
    </motion.div>
  );
}

export const HeroKPICard = memo(HeroKPICardBase);
