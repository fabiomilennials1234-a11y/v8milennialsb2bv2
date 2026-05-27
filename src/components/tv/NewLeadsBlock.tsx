import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, Sparkles } from "lucide-react";
import { useTVPeriod } from "@/contexts/TVPeriodContext";
import { useNewLeads } from "@/hooks/useNewLeads";

const SOURCE_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  organic: "Orgânico",
  indicacao: "Indicação",
  manual: "Manual",
  upload: "Upload",
  "—": "Sem origem",
};

const labelOf = (s: string) => SOURCE_LABELS[s] ?? s.replace(/_/g, " ");

export function NewLeadsBlock() {
  const { period, label, range } = useTVPeriod();
  const { total, buckets, topSources } = useNewLeads(range);

  const maxBucket = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <UserPlus className="w-5 h-5 text-[#4ade80]" />
        <span className="text-[12px] font-semibold text-[#f8f5e7]">Novos Leads</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={period}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.2 }}
            className="ml-auto text-[10px] font-medium text-[#8a857a] uppercase tracking-wider"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Big number */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${period}-${total}`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="flex items-baseline gap-2 mb-3"
        >
          <span className="font-display text-4xl font-bold text-[#f8f5e7] leading-none tabular-nums">
            {total}
          </span>
          <span className="text-xs text-[#8a857a] uppercase tracking-wider">
            {total === 1 ? "lead" : "leads"}
          </span>
        </motion.div>
      </AnimatePresence>

      {/* Sparkline diário */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-end gap-0.5 h-12 mb-2">
          {buckets.map((b, i) => {
            const h = (b.count / maxBucket) * 100;
            return (
              <motion.div
                key={b.key}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(h, 4)}%` }}
                transition={{ duration: 0.4, delay: i * 0.02, ease: "easeOut" }}
                className={`flex-1 rounded-t ${
                  b.count === 0 ? "bg-white/[0.04]" : "bg-gradient-to-t from-emerald-600 to-emerald-400"
                }`}
                title={`${b.key}: ${b.count}`}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[9px] text-[#8a857a] mb-3 px-0.5">
          <span>{buckets[0]?.key.slice(5).replace("-", "/")}</span>
          <span>{buckets[buckets.length - 1]?.key.slice(5).replace("-", "/")}</span>
        </div>

        {/* Top sources */}
        {topSources.length > 0 && (
          <div className="mt-auto pt-2 border-t border-white/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className="w-3 h-3 text-emerald-400/60" />
              <span className="text-[9px] uppercase tracking-wider text-[#8a857a]">Top Origens</span>
            </div>
            <div className="space-y-1">
              {topSources.map((s) => {
                const pct = (s.count / total) * 100;
                return (
                  <div key={s.source} className="flex items-center justify-between text-[11px]">
                    <span className="text-[#f8f5e7]/80 truncate max-w-[60%]">{labelOf(s.source)}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400/60 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-emerald-400 font-bold tabular-nums w-6 text-right">{s.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
