import { motion, AnimatePresence } from "framer-motion";
import { Calendar, UserCheck, UserX, Users } from "lucide-react";
import { useTVPeriod } from "@/contexts/TVPeriodContext";
import { useSDRPerformance, type SDRPerformanceRow } from "@/modules/engagement/hooks/useSDRPerformance";

type Metric = "marcadas" | "comparecidas" | "noShow";

const METRICS: { key: Metric; label: string; icon: React.ElementType; color: string; ringColor: string }[] = [
  { key: "marcadas", label: "Marcadas", icon: Calendar, color: "text-blue-400", ringColor: "from-blue-500/30 to-blue-600/5" },
  { key: "comparecidas", label: "Comparecidas", icon: UserCheck, color: "text-emerald-400", ringColor: "from-emerald-500/30 to-emerald-600/5" },
  { key: "noShow", label: "No-Show", icon: UserX, color: "text-amber-400", ringColor: "from-amber-500/30 to-amber-600/5" },
];

export function SDRPerformanceBlock() {
  const { period, label } = useTVPeriod();
  const { range } = useTVPeriod();
  const { totals, bySDR } = useSDRPerformance(range);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-5 h-5 text-blue-400" />
        <span className="text-sm font-bold text-white uppercase tracking-wider">Pré-Vendas</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={period}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.2 }}
            className="ml-auto text-[10px] font-medium text-white/40 uppercase tracking-wider"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* 3 colunas de métricas */}
      <div className="grid grid-cols-3 gap-2 flex-1 min-h-0">
        {METRICS.map((m) => (
          <SDRMetricColumn
            key={m.key}
            metric={m.key}
            label={m.label}
            icon={m.icon}
            color={m.color}
            ringColor={m.ringColor}
            total={totals[m.key]}
            bySDR={bySDR}
          />
        ))}
      </div>

      {/* No-show rate no rodapé */}
      <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-xs">
        <span className="text-white/40">Taxa de No-Show</span>
        <span className={`font-bold ${totals.noShowRate > 30 ? "text-red-400" : totals.noShowRate > 15 ? "text-amber-400" : "text-emerald-400"}`}>
          {totals.noShowRate.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function SDRMetricColumn({
  metric,
  label,
  icon: Icon,
  color,
  ringColor,
  total,
  bySDR,
}: {
  metric: Metric;
  label: string;
  icon: React.ElementType;
  color: string;
  ringColor: string;
  total: number;
  bySDR: SDRPerformanceRow[];
}) {
  const sorted = [...bySDR].sort((a, b) => b[metric] - a[metric]).slice(0, 5);
  const max = Math.max(...sorted.map((s) => s[metric]), 1);

  return (
    <div className={`relative rounded-xl p-2.5 bg-gradient-to-b ${ringColor} border border-white/5 flex flex-col`}>
      {/* Header coluna */}
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] text-white/60 uppercase tracking-wider font-medium">{label}</span>
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
          <p className={`text-3xl font-black ${color} font-racing leading-none mb-2`}>
            {total}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Lista SDRs */}
      <div className="flex-1 space-y-1 overflow-hidden">
        {sorted.length === 0 && (
          <p className="text-[10px] text-white/30 italic">sem registros</p>
        )}
        {sorted.map((sdr, i) => {
          const val = sdr[metric];
          if (val === 0) return null;
          const width = (val / max) * 100;
          return (
            <motion.div
              key={sdr.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="relative"
            >
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-white/70 truncate max-w-[80%]" title={sdr.name}>
                  {sdr.name}
                </span>
                <span className={`font-bold ${color}`}>{val}</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className={`h-full rounded-full bg-gradient-to-r ${ringColor.replace("/30", "/80").replace("/5", "/40")}`}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
