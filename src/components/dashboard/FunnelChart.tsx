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

export function FunnelChart({ title, steps }: FunnelChartProps) {
  const maxValue = Math.max(...steps.map((s) => s.value));

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="font-semibold mb-6">{title}</h3>

      <div className="space-y-3">
        {steps.map((step, index) => {
          const widthPercentage = (step.value / maxValue) * 100;
          const conversionRate =
            index > 0
              ? ((step.value / steps[index - 1].value) * 100).toFixed(1)
              : null;

          return (
            <div key={step.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{step.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{step.value}</span>
                  {conversionRate && (
                    <span className="text-xs text-muted-foreground">
                      ({conversionRate}%)
                    </span>
                  )}
                </div>
              </div>
              <div className="h-8 bg-muted rounded-lg overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${widthPercentage}%` }}
                  transition={{ duration: 0.6, delay: index * 0.1, ease: "easeOut" }}
                  className={`h-full rounded-lg flex items-center justify-end pr-2 ${step.color}`}
                >
                  {widthPercentage > 20 && (
                    <span className="text-xs font-semibold text-primary-foreground">
                      {step.value}
                    </span>
                  )}
                </motion.div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
