import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AT } from "./analytics-tokens";

interface FunnelStep {
  label: string;
  value: number;
  icon?: LucideIcon;
  color: string;
  lostCount?: number;
  avgDays?: number;
}

interface UnifiedFunnelProps {
  steps: FunnelStep[];
  title?: string;
  variant?: "compact" | "detailed";
}

function findBottleneckIndex(steps: FunnelStep[]): number {
  let maxDrop = 0;
  let bottleneck = -1;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].value;
    const curr = steps[i].value;
    const drop = prev > 0 ? (prev - curr) / prev : 0;
    if (drop > maxDrop) {
      maxDrop = drop;
      bottleneck = i;
    }
  }
  return bottleneck;
}

function UnifiedFunnelBase({ steps, title, variant = "compact" }: UnifiedFunnelProps) {
  const maxValue = Math.max(...steps.map((s) => s.value), 1);
  const bottleneckIndex = findBottleneckIndex(steps);
  const isDetailed = variant === "detailed";

  if (steps.length === 0) return null;

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      {title && (
        <p className={cn(AT.chartTitle, "mb-4")}>{title}</p>
      )}

      <div className="flex flex-col gap-1">
        {steps.map((step, i) => {
          const widthPct = maxValue > 0 ? Math.max((step.value / maxValue) * 100, 15) : 15;
          const isBottleneck = i === bottleneckIndex;
          const prevStep = i > 0 ? steps[i - 1] : null;
          const convPct = prevStep && prevStep.value > 0
            ? Math.round((step.value / prevStep.value) * 100)
            : null;
          const barHeight = isDetailed ? "h-12" : "h-10";

          return (
            <div key={step.label}>
              {/* Conversion indicator between stages */}
              {i > 0 && convPct !== null && (
                <div className="flex items-center gap-1.5 py-1 pl-3">
                  <ChevronDown className={cn(
                    "w-3 h-3",
                    isBottleneck ? "text-destructive" : "text-muted-foreground/40"
                  )} />
                  <span className={cn(
                    "text-[10px] tabular-nums font-medium",
                    isBottleneck ? "text-destructive" : "text-muted-foreground/50"
                  )}>
                    {convPct}%
                    {isDetailed && prevStep && prevStep.value - step.value > 0 && (
                      <> · {prevStep.value - step.value} saíram</>
                    )}
                    {isDetailed && step.avgDays != null && step.avgDays > 0 && (
                      <> · {step.avgDays.toFixed(1)}d</>
                    )}
                  </span>
                  {isBottleneck && isDetailed && (
                    <span className="text-[9px] font-semibold text-destructive uppercase tracking-wide flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      gargalo
                    </span>
                  )}
                </div>
              )}

              {/* Bar */}
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: `${widthPct}%`, opacity: 1 }}
                transition={{ duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "rounded-md flex items-center justify-between px-3 border-l-[3px]",
                  barHeight,
                  isBottleneck && "ring-2 ring-destructive/30 ring-offset-1 ring-offset-background"
                )}
                style={{
                  backgroundColor: `${step.color}14`, // ~8% opacity hex
                  borderLeftColor: step.color,
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {step.icon && (
                    <step.icon className="w-3.5 h-3.5 shrink-0" style={{ color: step.color }} />
                  )}
                  <span className="text-xs font-medium truncate">{step.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className={cn(AT.valueSm)}>{step.value.toLocaleString("pt-BR")}</span>
                  {isDetailed && step.lostCount != null && step.lostCount > 0 && (
                    <span className="text-[10px] text-muted-foreground/50">
                      ({step.lostCount} perdidos)
                    </span>
                  )}
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const UnifiedFunnel = memo(UnifiedFunnelBase);
