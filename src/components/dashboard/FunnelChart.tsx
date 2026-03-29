import { memo } from "react";
import { motion } from "framer-motion";

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

interface FunnelChartProps {
  title: string;
  steps: FunnelStep[];
}

function FunnelChartBase({ title, steps }: FunnelChartProps) {
  const maxValue = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <p className="stat-card-label mb-5">{title}</p>

      <div className="space-y-1.5">
        {steps.map((step, index) => {
          // Funnel shape: width decreases proportionally
          const widthPct = maxValue > 0 ? Math.max((step.value / maxValue) * 100, 18) : 18;
          const conversionRate =
            index > 0 && steps[index - 1].value > 0
              ? ((step.value / steps[index - 1].value) * 100).toFixed(0)
              : null;

          return (
            <div key={step.label} className="flex flex-col items-center">
              {/* Conversion connector */}
              {conversionRate && (
                <div className="flex items-center justify-center py-0.5">
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                    {conversionRate}%
                  </span>
                </div>
              )}

              {/* Funnel bar — centered, width shrinks */}
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: `${widthPct}%`, opacity: 1 }}
                transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}
                className={`h-11 rounded-lg flex items-center justify-between px-3 ${step.color}`}
              >
                <span className="text-[12px] font-medium text-primary-foreground truncate">
                  {step.label}
                </span>
                <span className="text-[12px] font-bold text-primary-foreground tabular-nums">
                  {step.value}
                </span>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const FunnelChart = memo(FunnelChartBase);
