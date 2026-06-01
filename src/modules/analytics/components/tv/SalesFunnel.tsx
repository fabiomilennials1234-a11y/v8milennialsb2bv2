import { motion } from "framer-motion";
import { Filter } from "lucide-react";

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

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString("pt-BR");
};

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
  const steps = [
    { label: "Reuniões Marcadas", value: reunioesMarcadas, grad: "linear-gradient(90deg,#1e3a8a,#3b82f6)", textInBar: "#f8f5e7" },
    { label: "Comparecidas", value: comparecidas, grad: "linear-gradient(90deg,#155e63,#22d3ee)", textInBar: "#f8f5e7" },
    { label: "Marcando R2", value: marcandoR2, totalValue: marcandoR2Value, grad: "linear-gradient(90deg,#c97912,#ed9326)", textInBar: "#1c1c1c" },
    { label: "R2 Marcadas", value: r2Marcadas, totalValue: r2MarcadasValue, grad: "linear-gradient(90deg,#9a3412,#f97316)", textInBar: "#f8f5e7" },
    { label: "Vendido", value: vendido, totalValue: vendidoValue, grad: "linear-gradient(90deg,#15803d,#22c55e)", textInBar: "#f8f5e7", valueColor: "#4ade80" },
  ];

  const maxValue = Math.max(reunioesMarcadas, 1);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#f8f5e7] mb-3">
        <Filter className="w-3.5 h-3.5 text-[#ed9326]" />
        Funil de Vendas
      </div>

      {/* Horizontal bars */}
      <div className="flex-1 flex flex-col justify-center space-y-2">
        {steps.map((step, index) => {
          const widthPct = Math.max((step.value / maxValue) * 100, 8);
          const conversionRate =
            index > 0 && steps[index - 1].value > 0
              ? Math.round((step.value / steps[index - 1].value) * 100)
              : null;

          return (
            <div key={step.label}>
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-[#f8f5e7]/90 font-medium">{step.label}</span>
                <span className="text-[#8a857a] tabular-nums">
                  {conversionRate != null ? `${conversionRate}%` : " "}
                </span>
              </div>
              <div className="relative h-5 rounded-md bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${widthPct}%` }}
                  transition={{ duration: 1, delay: index * 0.1, ease: [0.2, 0.85, 0.25, 1] }}
                  className="h-full rounded-md"
                  style={{ background: step.grad }}
                />
                <span
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold tabular-nums"
                  style={{ color: step.textInBar }}
                >
                  {step.value}
                </span>
                {step.totalValue !== undefined && step.totalValue > 0 && (
                  <span
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold tabular-nums"
                    style={{ color: step.valueColor ?? "#f8f5e7" }}
                  >
                    R$ {formatCurrency(step.totalValue)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer total conversion */}
      <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
        <span className="text-[#8a857a]">Taxa Total</span>
        <span className="font-bold" style={{ color: "#4ade80" }}>
          {reunioesMarcadas > 0 ? ((vendido / reunioesMarcadas) * 100).toFixed(1) : 0}% de conversão
        </span>
      </div>
    </div>
  );
}
