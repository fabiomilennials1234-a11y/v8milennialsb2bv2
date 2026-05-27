import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Calendar, FileText, DollarSign, TrendingUp, Award } from "lucide-react";
import { useTVPeriod } from "@/contexts/TVPeriodContext";
import { useCloserPerformance } from "@/hooks/useCloserPerformance";

const formatCurrency = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
};

export function CloserPerformanceBlock() {
  const { period, label, range } = useTVPeriod();
  const { byCloser, totals, topCloserId } = useCloserPerformance(range);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-5 h-5 text-[#ffd400]" />
        <span className="text-[12px] font-semibold text-[#f8f5e7]">Closers</span>
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

      {/* Tabela */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Header tabela */}
        <div className="grid grid-cols-[1.6fr_0.6fr_0.6fr_0.6fr_0.9fr_0.7fr_0.7fr] gap-1 px-2 pb-1.5 border-b border-white/5 text-[9px] uppercase tracking-wider text-[#8a857a]">
          <span>Closer</span>
          <span className="text-right" title="Reuniões realizadas"><Calendar className="w-3 h-3 inline" /></span>
          <span className="text-right" title="Propostas"><FileText className="w-3 h-3 inline" /></span>
          <span className="text-right" title="Vendas"><Award className="w-3 h-3 inline" /></span>
          <span className="text-right" title="Valor vendido"><DollarSign className="w-3 h-3 inline" /></span>
          <span className="text-right">Ticket</span>
          <span className="text-right" title="Taxa conversão"><TrendingUp className="w-3 h-3 inline" /></span>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto space-y-0.5 pt-1">
          {byCloser.length === 0 && (
            <p className="text-xs text-white/30 text-center py-4">Sem closers ativos</p>
          )}

          {byCloser.map((c, i) => {
            const isTop = c.id === topCloserId && c.vendasValor > 0;
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`grid grid-cols-[1.6fr_0.6fr_0.6fr_0.6fr_0.9fr_0.7fr_0.7fr] gap-1 px-2 py-1.5 rounded-lg items-center text-xs ${
                  isTop
                    ? "bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20"
                    : "hover:bg-white/[0.02]"
                }`}
              >
                {/* Closer + avatar */}
                <div className="flex items-center gap-2 min-w-0">
                  {isTop && (
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    </motion.div>
                  )}
                  {c.avatarUrl ? (
                    <img src={c.avatarUrl} alt={c.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-[#8a857a] shrink-0">
                      {c.name.charAt(0)}
                    </div>
                  )}
                  <span className={`truncate font-medium ${isTop ? "text-amber-300" : "text-[#f8f5e7]/90"}`} title={c.name}>
                    {c.name}
                  </span>
                </div>

                <span className="text-right text-[#f8f5e7]/80">{c.reunioesRealizadas}</span>
                <span className="text-right text-[#f8f5e7]/80">{c.propostas}</span>
                <span className={`text-right font-bold ${c.vendas > 0 ? "text-emerald-400" : "text-[#8a857a]"}`}>{c.vendas}</span>
                <span className={`text-right font-bold ${c.vendasValor > 0 ? "text-emerald-400" : "text-[#8a857a]"}`}>
                  {c.vendasValor > 0 ? `R$ ${formatCurrency(c.vendasValor)}` : "—"}
                </span>
                <span className="text-right text-[#8a857a]">
                  {c.ticketMedio > 0 ? `R$ ${formatCurrency(c.ticketMedio)}` : "—"}
                </span>
                <span className={`text-right font-bold ${c.conversao >= 30 ? "text-emerald-400" : c.conversao >= 15 ? "text-amber-400" : "text-[#8a857a]"}`}>
                  {c.propostas > 0 ? `${c.conversao.toFixed(0)}%` : "—"}
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Footer total */}
        {byCloser.length > 0 && (
          <div className="mt-1 pt-1.5 border-t border-white/5 grid grid-cols-[1.6fr_0.6fr_0.6fr_0.6fr_0.9fr_0.7fr_0.7fr] gap-1 px-2 text-[10px]">
            <span className="text-[#8a857a] uppercase tracking-wider">Total</span>
            <span className="text-right text-[#f8f5e7]/90 font-bold">{totals.reunioesRealizadas}</span>
            <span className="text-right text-[#f8f5e7]/90 font-bold">{totals.propostas}</span>
            <span className="text-right text-emerald-400 font-bold">{totals.vendas}</span>
            <span className="text-right text-emerald-400 font-bold">
              {totals.vendasValor > 0 ? `R$ ${formatCurrency(totals.vendasValor)}` : "—"}
            </span>
            <span className="text-right text-[#8a857a]">
              {totals.ticketMedio > 0 ? `R$ ${formatCurrency(totals.ticketMedio)}` : "—"}
            </span>
            <span className="text-right text-[#f8f5e7]/90 font-bold">
              {totals.propostas > 0 ? `${totals.conversao.toFixed(0)}%` : "—"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
