import { motion, AnimatePresence } from "framer-motion";
import { Clock3 } from "lucide-react";
import { useTVPeriod } from "@/contexts/TVPeriodContext";
import { getPeriodShortLabel, TV_PERIODS } from "@/lib/tv-periods";

export function PeriodPill() {
  const { period, label, progress } = useTVPeriod();

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 relative overflow-hidden">
      {/* Progress fill background */}
      <div
        className="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-200 ease-linear"
        style={{ width: `${progress * 100}%` }}
      />

      <Clock3 className="w-4 h-4 text-primary relative z-10" />

      <div className="relative z-10 flex items-center gap-2">
        <AnimatePresence mode="wait">
          <motion.span
            key={period}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-sm font-bold text-white tracking-wide"
          >
            {label}
          </motion.span>
        </AnimatePresence>

        {/* Mini dots indicando ordem */}
        <div className="flex items-center gap-1 ml-1">
          {TV_PERIODS.map((p) => (
            <div
              key={p}
              title={getPeriodShortLabel(p)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                p === period ? "bg-primary" : "bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
