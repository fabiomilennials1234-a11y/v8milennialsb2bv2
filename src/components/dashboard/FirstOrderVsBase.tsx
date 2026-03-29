import { memo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "framer-motion";

interface FirstOrderVsBaseProps {
  firstOrderValue: number;
  baseActiveValue: number;
}

function FirstOrderVsBaseBase({ firstOrderValue, baseActiveValue }: FirstOrderVsBaseProps) {
  const total = firstOrderValue + baseActiveValue;
  const data = [
    { name: "Primeiro Pedido", value: firstOrderValue },
    { name: "Base Ativa", value: baseActiveValue },
  ];
  const COLORS = ["hsl(var(--primary))", "hsl(var(--success))"];

  const firstPct = total > 0 ? Math.round((firstOrderValue / total) * 100) : 0;
  const basePct = total > 0 ? Math.round((baseActiveValue / total) * 100) : 0;

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5"
    >
      <h3 className="font-semibold text-sm mb-4">Receita por Tipo de Cliente</h3>
      <div className="flex items-center gap-4">
        <div className="w-28 h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                innerRadius={30}
                outerRadius={50}
                dataKey="value"
                animationBegin={300}
                animationDuration={800}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{
                  fontSize: 12,
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground">Primeiro Pedido</span>
            </div>
            <p className="text-sm font-bold">{firstPct}% — {formatCurrency(firstOrderValue)}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-success" />
              <span className="text-xs text-muted-foreground">Base Ativa</span>
            </div>
            <p className="text-sm font-bold">{basePct}% — {formatCurrency(baseActiveValue)}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export const FirstOrderVsBase = memo(FirstOrderVsBaseBase);
