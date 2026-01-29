import { motion } from "framer-motion";
import { Users, UserCheck, Target, Calendar, Trophy, DollarSign } from "lucide-react";

interface FunnelStep {
  label: string;
  value: number;
  totalValue?: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

interface SalesFunnelProps {
  reunioesMarcadas: number;
  comparecidas: number;
  marcandoR2: number;
  marcandoR2Value: number;
  r2Marcadas: number;
  r2MarcadasValue: number;
  vendido: number;
  vendidoValue: number;
}

export function SalesFunnel({
  reunioesMarcadas,
  comparecidas,
  marcandoR2,
  marcandoR2Value,
  r2Marcadas,
  r2MarcadasValue,
  vendido,
  vendidoValue,
}: SalesFunnelProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toLocaleString("pt-BR");
  };

  const steps: FunnelStep[] = [
    {
      label: "Reuniões Marcadas",
      value: reunioesMarcadas,
      icon: <Calendar className="w-4 h-4" />,
      color: "text-blue-400",
      bgColor: "from-blue-500/20 to-blue-600/10",
    },
    {
      label: "Comparecidas",
      value: comparecidas,
      icon: <UserCheck className="w-4 h-4" />,
      color: "text-cyan-400",
      bgColor: "from-cyan-500/20 to-cyan-600/10",
    },
    {
      label: "Marcando R2",
      value: marcandoR2,
      totalValue: marcandoR2Value,
      icon: <Target className="w-4 h-4" />,
      color: "text-amber-400",
      bgColor: "from-amber-500/20 to-amber-600/10",
    },
    {
      label: "R2 Marcadas",
      value: r2Marcadas,
      totalValue: r2MarcadasValue,
      icon: <Users className="w-4 h-4" />,
      color: "text-orange-400",
      bgColor: "from-orange-500/20 to-orange-600/10",
    },
    {
      label: "Vendido",
      value: vendido,
      totalValue: vendidoValue,
      icon: <Trophy className="w-4 h-4" />,
      color: "text-emerald-400",
      bgColor: "from-emerald-500/20 to-emerald-600/10",
    },
  ];

  const maxValue = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
          <TrendingDown className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-bold text-white uppercase tracking-wider">
          Funil de Vendas
        </span>
      </div>

      {/* Funnel Steps */}
      <div className="flex-1 flex flex-col justify-between gap-2">
        {steps.map((step, index) => {
          const widthPercentage = Math.max((step.value / maxValue) * 100, 15);
          const conversionRate =
            index > 0 && steps[index - 1].value > 0
              ? ((step.value / steps[index - 1].value) * 100).toFixed(0)
              : null;

          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="relative"
            >
              {/* Connector Line */}
              {index > 0 && (
                <div className="absolute -top-2 left-6 h-2 w-px bg-white/10" />
              )}

              <div className="flex items-center gap-3">
                {/* Icon Circle */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.3, delay: index * 0.1 + 0.2 }}
                  className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br ${step.bgColor} border border-white/10 shrink-0`}
                >
                  <span className={step.color}>{step.icon}</span>
                </motion.div>

                {/* Bar and Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-white/70 truncate">
                      {step.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {conversionRate && (
                        <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">
                          {conversionRate}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative h-7 bg-white/5 rounded-lg overflow-hidden border border-white/5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPercentage}%` }}
                      transition={{
                        duration: 0.8,
                        delay: index * 0.15,
                        ease: "easeOut",
                      }}
                      className={`absolute inset-y-0 left-0 bg-gradient-to-r ${step.bgColor} rounded-lg`}
                    >
                      {/* Shine effect */}
                      <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-white/10 to-transparent" />
                    </motion.div>

                    {/* Values inside bar */}
                    <div className="absolute inset-0 flex items-center justify-between px-3">
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.15 + 0.3 }}
                        className={`text-sm font-bold ${step.color}`}
                      >
                        {step.value}
                      </motion.span>

                      {step.totalValue !== undefined && step.totalValue > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: index * 0.15 + 0.4 }}
                          className="flex items-center gap-1 text-xs text-white/60"
                        >
                          <DollarSign className="w-3 h-3" />
                          <span className="font-semibold">
                            R$ {formatCurrency(step.totalValue)}
                          </span>
                        </motion.div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Bottom Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="mt-4 pt-3 border-t border-white/5"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">Taxa Total</span>
          <span className="text-emerald-400 font-bold">
            {reunioesMarcadas > 0
              ? ((vendido / reunioesMarcadas) * 100).toFixed(1)
              : 0}
            % de conversão
          </span>
        </div>
      </motion.div>
    </div>
  );
}

// Icon for header
import { TrendingDown } from "lucide-react";
