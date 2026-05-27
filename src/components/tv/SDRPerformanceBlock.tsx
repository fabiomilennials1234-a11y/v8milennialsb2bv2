import { motion, AnimatePresence } from "framer-motion";
import { Users } from "lucide-react";
import { useTVPeriod } from "@/contexts/TVPeriodContext";
import { useSDRPerformance, type SDRPerformanceRow } from "@/hooks/useSDRPerformance";

type Metric = "marcadas" | "comparecidas" | "noShow";

interface MetricCfg {
  key: Metric;
  label: string;
  labelColor: string;
  numberColor: string;
  bg: string;
  border: string;
}

const METRICS: MetricCfg[] = [
  { key: "marcadas", label: "Marcadas", labelColor: "#93c5fd", numberColor: "#60a5fa", bg: "rgba(59,130,246,0.07)", border: "rgba(59,130,246,0.18)" },
  { key: "comparecidas", label: "Compareceu", labelColor: "#86efac", numberColor: "#4ade80", bg: "rgba(34,197,94,0.07)", border: "rgba(34,197,94,0.18)" },
  { key: "noShow", label: "No-Show", labelColor: "#f5a93f", numberColor: "#f5a93f", bg: "rgba(237,147,38,0.07)", border: "rgba(237,147,38,0.2)" },
];

export function SDRPerformanceBlock() {
  const { period, label, range } = useTVPeriod();
  const { totals, bySDR } = useSDRPerformance(range);

  const noShowColor =
    totals.noShowRate > 30 ? "#f87171" : totals.noShowRate > 15 ? "#f5a93f" : "#4ade80";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#f8f5e7]">
          <Users className="w-3.5 h-3.5 text-[#ed9326]" />
          Pré-vendas
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={period}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.2 }}
            className="text-[8.5px] font-medium text-[#8a857a] uppercase tracking-wider"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* 3 colunas de métricas */}
      <div className="grid grid-cols-3 gap-2 flex-1 min-h-0">
        {METRICS.map((m) => (
          <SDRMetricColumn key={m.key} cfg={m} total={totals[m.key]} bySDR={bySDR} />
        ))}
      </div>

      {/* No-show rate no rodapé */}
      <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-[#8a857a]">Taxa de No-Show</span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: noShowColor }}>
          {totals.noShowRate.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function SDRMetricColumn({
  cfg,
  total,
  bySDR,
}: {
  cfg: MetricCfg;
  total: number;
  bySDR: SDRPerformanceRow[];
}) {
  const sorted = [...bySDR].sort((a, b) => b[cfg.key] - a[cfg.key]).slice(0, 4);

  return (
    <div className="rounded-lg p-2.5" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      {/* Label */}
      <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: cfg.labelColor }}>
        {cfg.label}
      </div>

      {/* Total grande */}
      <AnimatePresence mode="wait">
        <motion.div
          key={total}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          <p className="font-display text-xl font-bold tabular-nums leading-none" style={{ color: cfg.numberColor }}>
            {total}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Lista SDRs — nome + valor (sem barras) */}
      <div className="mt-2 space-y-1 text-[9.5px]">
        {sorted.length === 0 && <p className="text-[#8a857a] italic">sem registros</p>}
        {sorted.map((sdr) => {
          const val = sdr[cfg.key];
          if (val === 0) return null;
          return (
            <div key={sdr.id} className="flex justify-between">
              <span className="text-[#f8f5e7]/80 truncate max-w-[70%]" title={sdr.name}>
                {sdr.name.split(" ")[0]}
              </span>
              <span className="text-[#f8f5e7] font-medium tabular-nums">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
