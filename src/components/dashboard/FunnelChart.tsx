import { memo } from "react";
import { motion } from "framer-motion";
import { Users, Calendar, FileText, Trophy } from "lucide-react";

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

interface FunnelChartProps {
  title: string;
  steps: FunnelStep[];
}

// Gamified funnel: gradient progression from cool (top) to hot (bottom)
// Each level represents deeper commitment — colors warm up as you go
const FUNNEL_STYLES = [
  {
    bg: "from-blue-500/90 to-blue-600/90",
    icon: Users,
    glow: "shadow-blue-500/20",
  },
  {
    bg: "from-violet-500/90 to-violet-600/90",
    icon: Calendar,
    glow: "shadow-violet-500/20",
  },
  {
    bg: "from-amber-500/90 to-orange-500/90",
    icon: FileText,
    glow: "shadow-amber-500/20",
  },
  {
    bg: "from-emerald-500/90 to-emerald-600/90",
    icon: Trophy,
    glow: "shadow-emerald-500/20",
  },
];

function FunnelChartBase({ title, steps }: FunnelChartProps) {
  const maxValue = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <p className="stat-card-label mb-5">{title}</p>

      <div className="flex flex-col items-center gap-1">
        {steps.map((step, index) => {
          const style = FUNNEL_STYLES[index] || FUNNEL_STYLES[0];
          const StepIcon = style.icon;

          // Funnel shape: width decreases per step
          const widthPct = maxValue > 0
            ? Math.max((step.value / maxValue) * 100, 22)
            : 22;

          const conversionRate =
            index > 0 && steps[index - 1].value > 0
              ? ((step.value / steps[index - 1].value) * 100).toFixed(0)
              : null;

          return (
            <div key={step.label} className="flex flex-col items-center w-full">
              {/* Conversion connector */}
              {conversionRate && (
                <div className="flex items-center gap-1.5 py-0.5">
                  <div className="w-4 h-px bg-border" />
                  <span className="text-[10px] font-semibold text-muted-foreground/50 tabular-nums">
                    {conversionRate}%
                  </span>
                  <div className="w-4 h-px bg-border" />
                </div>
              )}

              {/* Funnel bar */}
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: `${widthPct}%`, opacity: 1 }}
                transition={{ duration: 0.6, delay: index * 0.12, ease: [0.16, 1, 0.3, 1] }}
                className={`h-12 rounded-lg bg-gradient-to-r ${style.bg} shadow-md ${style.glow} flex items-center justify-between px-3 group cursor-default`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StepIcon className="w-4 h-4 text-white/80 flex-shrink-0" />
                  <span className="text-[12px] font-semibold text-white truncate">
                    {step.label}
                  </span>
                </div>
                <span className="text-[14px] font-bold text-white tabular-nums flex-shrink-0 ml-2">
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
