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
 *
 * V5: mesma geometria da `TabsList variant="pill"` (trilho em tinta, gatilhos
 * em pílula), mas o ativo é AZUL de insights, não ouro — a área tem identidade
 * própria. Não migra para Radix Tabs: o painel (`insights-panel-*`) vive em
 * `InsightsContent`, animado por `AnimatePresence`, e o par id/aria-controls
 * já está costurado à mão.
 */
export function InsightsModeTabs({ value, onChange }: InsightsModeTabsProps) {
  const reduce = useReducedMotion();

  return (
    <div
      role="tablist"
      aria-label="Modo de visualização"
      className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-tinta p-1 shadow-relevo-tinta"
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
              "relative whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-insights",
              active ? "text-insights-foreground" : "text-tinta-muted hover:text-tinta-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="insights-mode-pill"
                className="absolute inset-0 -z-0 rounded-full bg-insights shadow-[0_6px_18px_-6px_hsl(var(--insights)/.6)]"
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
