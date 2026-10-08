import { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ContinuousFunnelStage {
  key: string;
  label: string;
  count: number;
  /** Linha extra sob o label (ex.: "R$ 184.500"). */
  valueLabel?: string;
  /** "success" pinta a etapa de verde (ex.: Vendido = dinheiro fechado). */
  tone?: "gold" | "success";
}

interface ContinuousFunnelProps {
  stages: ContinuousFunnelStage[];
  /** Unidade pro empty state ("leads", "reuniões", "propostas"). */
  unit?: string;
}

const GOLD_OPACITY = [1, 0.8, 0.6, 0.45, 0.32, 0.22];

function passRateColor(rate: number) {
  if (rate >= 60) return "text-success";
  if (rate >= 30) return "text-primary";
  return "text-destructive";
}

/**
 * Funil contínuo dos analytics — barras proporcionais ligadas por curvas de
 * fluxo, com a taxa de passagem entre os números de cada etapa.
 */
export function ContinuousFunnel({ stages, unit = "registros" }: ContinuousFunnelProps) {
  const max = Math.max(...stages.map((s) => s.count), 0);

  const heights = useMemo(
    () => stages.map((s) => (max > 0 ? Math.max((s.count / max) * 100, s.count > 0 ? 6 : 2) : 2)),
    [stages, max]
  );

  if (max === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center border border-dashed border-border/50 rounded-lg">
        Nenhum {unit.replace(/s$/, "")} no período
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-stretch h-[170px]">
        {stages.map((stage, i) => {
          const isSuccess = stage.tone === "success";
          return (
            <div key={stage.key} className="contents">
              {i > 0 && (
                <div className="relative w-[34px] shrink-0">
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 34 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d={`M0 ${100 - heights[i - 1]} C 17 ${100 - heights[i - 1]}, 17 ${100 - heights[i]}, 34 ${100 - heights[i]} L34 100 L0 100 Z`}
                      fill={
                        isSuccess
                          ? "hsl(var(--success) / 0.14)"
                          : `hsl(var(--primary) / ${0.16 - i * 0.03})`
                      }
                    />
                  </svg>
                </div>
              )}
              <div className="flex-1 flex flex-col justify-end min-w-0">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${heights[i]}%` }}
                  transition={{ duration: 0.7, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    "w-full rounded-t-lg rounded-b",
                    isSuccess
                      ? "bg-gradient-to-b from-success to-success/60 shadow-[inset_0_1px_0_hsl(var(--success)/0.5)]"
                      : "shadow-[inset_0_1px_0_hsl(50_100%_70%/0.35)]"
                  )}
                  style={
                    isSuccess
                      ? undefined
                      : {
                          background: `linear-gradient(180deg, hsl(var(--primary) / ${GOLD_OPACITY[i] ?? 0.2}), hsl(40 90% 38% / ${GOLD_OPACITY[i] ?? 0.2}))`,
                        }
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex mt-3.5">
        {stages.map((stage, i) => {
          const prev = i > 0 ? stages[i - 1].count : null;
          const rate = prev !== null && prev > 0 ? (stage.count / prev) * 100 : null;
          return (
            <div key={stage.key} className="contents">
              {i > 0 && (
                <div className="w-[34px] shrink-0 flex items-start justify-center pt-1">
                  {rate !== null && (
                    <span className={cn("text-[10px] font-bold tabular-nums", passRateColor(rate))}>
                      {rate.toFixed(0)}%
                    </span>
                  )}
                </div>
              )}
              <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                <span className="text-[22px] leading-7 font-bold tabular-nums tracking-tight">
                  {stage.count}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">{stage.label}</span>
                {stage.valueLabel && (
                  <span
                    className={cn(
                      "text-[11px] font-semibold tabular-nums",
                      stage.tone === "success" ? "text-success" : "text-primary"
                    )}
                  >
                    {stage.valueLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
