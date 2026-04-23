import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PipeStat {
  id: string;
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: LucideIcon;
  hero?: boolean;
  tone?: "default" | "success" | "primary" | "destructive" | "chart-5" | "chart-4";
  delta?: { value: string; direction: "up" | "down" | "flat" } | null;
  onClick?: () => void;
  active?: boolean;
}

const TONE_COLORS: Record<NonNullable<PipeStat["tone"]>, string> = {
  default:     "text-foreground",
  primary:     "text-primary",
  success:     "text-success",
  destructive: "text-destructive",
  "chart-5":   "text-chart-5",
  "chart-4":   "text-chart-4",
};

export interface PipeStatsRowProps {
  stats: PipeStat[];
  showDeltaPlaceholder?: boolean;
}

export function PipeStatsRow({ stats, showDeltaPlaceholder = false }: PipeStatsRowProps) {
  if (stats.length === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-4",
        stats.length === 2 && "grid-cols-2",
        stats.length === 3 && "grid-cols-2 md:grid-cols-3",
        stats.length === 4 && "grid-cols-2 md:grid-cols-4",
        stats.length === 5 && "grid-cols-2 md:grid-cols-5",
        stats.length >= 6 && "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
      )}
    >
      {stats.map((stat, i) => {
        const toneClass = TONE_COLORS[stat.tone || "default"];
        const Icon = stat.icon;
        const interactive = !!stat.onClick;
        const Wrapper = interactive ? motion.button : motion.div;

        return (
          <Wrapper
            key={stat.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={stat.onClick}
            className={cn(
              "bg-card rounded-lg border border-border p-4 text-left",
              interactive && "cursor-pointer transition-all hover:border-border/80",
              stat.active && "ring-2 ring-primary/40 border-primary/60",
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              {Icon && <Icon className={cn("w-4 h-4 opacity-70", toneClass)} />}
            </div>
            <p className={cn("text-2xl font-bold tabular-nums mt-1", toneClass)}>
              {stat.value}
            </p>
            {stat.sublabel && (
              <p className="text-xs text-muted-foreground mt-1">{stat.sublabel}</p>
            )}
            {showDeltaPlaceholder && stat.delta && (
              <span
                className={cn(
                  "text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-full mt-2 inline-block",
                  stat.delta.direction === "up" && "bg-success/10 text-success",
                  stat.delta.direction === "down" && "bg-destructive/10 text-destructive",
                  stat.delta.direction === "flat" && "bg-muted text-muted-foreground",
                )}
              >
                {stat.delta.direction === "up" ? "↑" : stat.delta.direction === "down" ? "↓" : "→"} {stat.delta.value}
              </span>
            )}
          </Wrapper>
        );
      })}
    </div>
  );
}
