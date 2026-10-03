import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export type InsightsMode = "dados" | "projecao";

interface InsightsModeTabsProps {
  value: InsightsMode;
  onChange: (mode: InsightsMode) => void;
}

const TABS: { key: InsightsMode; label: string }[] = [
  { key: "dados", label: "Dados" },
  { key: "projecao", label: "Projeção" },
];

/**
 * Segmented control Dados | Projeção (DESIGN §5). Indicador desliza via
 * framer-motion `layoutId` (250ms). `role=tablist/tab` para a11y.
 */
export function InsightsModeTabs({ value, onChange }: InsightsModeTabsProps) {
  const reduce = useReducedMotion();

  return (
    <div
      role="tablist"
      aria-label="Modo de visualização"
      className="inline-flex items-center gap-1 rounded-full bg-muted/60 p-1"
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            id={`insights-tab-${tab.key}`}
            aria-controls={`insights-panel-${tab.key}`}
            onClick={() => onChange(tab.key)}
            className={cn(
              "relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active ? "text-insights-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="insights-mode-pill"
                className="absolute inset-0 -z-0 rounded-full bg-insights shadow-sm"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 320, damping: 30 }
                }
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
