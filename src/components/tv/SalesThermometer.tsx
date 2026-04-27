import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";

interface SalesThermometerProps {
  meta: number;
  atual: number;
  ondeDeveria: number;
}

export function SalesThermometer({ meta, atual, ondeDeveria }: SalesThermometerProps) {
  const percentage = meta > 0 ? Math.min((atual / meta) * 100, 100) : 0;
  const expectedPercentage = meta > 0 ? Math.min((ondeDeveria / meta) * 100, 100) : 0;
  const isAhead = atual >= ondeDeveria;
  const isCompleted = atual >= meta;
  const diferenca = Math.abs(atual - ondeDeveria);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(1)}K`;
    return `R$ ${value.toFixed(0)}`;
  };

  // Scale divisions based on meta
  const getScaleValue = (percent: number) => {
    const value = (meta * percent) / 100;
    if (value >= 1000) return `${Math.round(value / 1000)}K`;
    return `${Math.round(value)}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Thermometer Container */}
      <div className="flex-1 flex items-center justify-center gap-4 min-h-0">
        {/* Scale Labels - Aligned with thermometer divisions */}
        <div className="h-[200px] flex flex-col justify-between text-right pr-1">
          <span className="text-xs font-bold text-sidebar-foreground/70">{getScaleValue(100)}</span>
          <span className="text-xs font-bold text-sidebar-foreground/70">{getScaleValue(75)}</span>
          <span className="text-xs font-bold text-sidebar-foreground/70">{getScaleValue(50)}</span>
          <span className="text-xs font-bold text-sidebar-foreground/70">{getScaleValue(25)}</span>
          <span className="text-xs font-bold text-sidebar-foreground/70">0</span>
        </div>

        {/* Thermometer */}
        <div className="relative flex flex-col items-center">
          {/* Tube */}
          <div className="relative w-10 h-[200px] rounded-t-full bg-sidebar-accent/60 border-2 border-sidebar-border overflow-hidden">
            {/* Division lines */}
            {[25, 50, 75].map((p) => (
              <div 
                key={p} 
                className="absolute left-0 right-0 h-0.5 bg-sidebar-border/80" 
                style={{ bottom: `${p}%` }} 
              />
            ))}

            {/* Expected position marker */}
            <div 
              className="absolute left-0 right-0 h-1 bg-white/50 z-10"
              style={{ bottom: `${expectedPercentage}%` }}
            >
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0 border-t-[5px] border-b-[5px] border-l-[8px] border-transparent border-l-white/50" />
            </div>

            {/* Fill */}
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${percentage}%` }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className={`absolute bottom-0 left-0 right-0 ${
                isAhead 
                  ? "bg-gradient-to-t from-emerald-600 via-emerald-500 to-emerald-400" 
                  : "bg-gradient-to-t from-amber-600 via-amber-500 to-yellow-400"
              }`}
            >
              {/* Shine effect */}
              <div className="absolute inset-y-0 left-1.5 w-2 bg-white/25 rounded-full" />
            </motion.div>
          </div>

          {/* Bulb */}
          <motion.div 
            animate={{ 
              boxShadow: isAhead 
                ? ["0 0 10px rgba(16,185,129,0.4)", "0 0 20px rgba(16,185,129,0.6)", "0 0 10px rgba(16,185,129,0.4)"]
                : ["0 0 10px rgba(245,158,11,0.4)", "0 0 20px rgba(245,158,11,0.6)", "0 0 10px rgba(245,158,11,0.4)"]
            }}
            transition={{ repeat: Infinity, duration: 2 }}
            className={`w-16 h-16 rounded-full -mt-3 flex items-center justify-center z-10 border-2 ${
              isAhead 
                ? "bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-400/50" 
                : "bg-gradient-to-br from-amber-400 to-amber-600 border-amber-400/50"
            }`}
          >
            <span className="text-xl font-black text-white drop-shadow-md">
              {percentage.toFixed(0)}%
            </span>
          </motion.div>
        </div>

        {/* Current Value Label - More dopaminergic */}
        <div className="relative h-[200px]">
          <motion.div
            initial={{ bottom: "0%" }}
            animate={{ bottom: `${Math.max(0, percentage - 8)}%` }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            className="absolute left-0"
            style={{ bottom: `${Math.max(0, percentage - 8)}%` }}
          >
            <motion.div 
              className="flex items-center gap-1"
              animate={{ scale: [1, 1.02, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <div className={`w-0 h-0 border-t-[6px] border-b-[6px] border-r-[8px] border-transparent ${
                isAhead ? "border-r-emerald-500" : "border-r-amber-500"
              }`} />
              <motion.div 
                className={`px-3 py-1.5 rounded-lg text-white font-black text-sm shadow-lg ${
                  isAhead 
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-600" 
                    : "bg-gradient-to-r from-amber-500 to-amber-600"
                }`}
                animate={{ 
                  boxShadow: isAhead 
                    ? ["0 4px 12px rgba(16,185,129,0.3)", "0 4px 20px rgba(16,185,129,0.5)", "0 4px 12px rgba(16,185,129,0.3)"]
                    : ["0 4px 12px rgba(245,158,11,0.3)", "0 4px 20px rgba(245,158,11,0.5)", "0 4px 12px rgba(245,158,11,0.3)"]
                }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <span className="tracking-tight">{formatCurrency(atual)}</span>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Status Bar */}
      <div className={`mt-4 py-3 px-4 rounded-lg flex items-center justify-center gap-2 ${
        isAhead 
          ? "bg-emerald-500/15 border border-emerald-500/30" 
          : "bg-amber-500/15 border border-amber-500/30"
      }`}>
        {isAhead ? (
          <TrendingDown className="w-4 h-4 text-emerald-400 rotate-180" />
        ) : (
          <TrendingDown className="w-4 h-4 text-amber-400" />
        )}
        <span className={`text-sm font-bold ${isAhead ? "text-emerald-400" : "text-amber-400"}`}>
          {isAhead ? "+" : "-"}{formatCurrency(diferenca)} {isAhead ? "à frente" : "atrás"}
        </span>
      </div>

      {/* Celebration Overlay */}
      {isCompleted && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-xl z-50"
        >
          <div className="text-center">
            <motion.span 
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="text-5xl block"
            >
              🏆
            </motion.span>
            <p className="text-xl font-black text-emerald-400 mt-2">META BATIDA!</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}