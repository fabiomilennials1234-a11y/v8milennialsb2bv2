import { useMemo } from "react";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface CalorData {
  calor: number;
  value: number;
  count: number;
}

interface CalorAnalyticsChartProps {
  data: CalorData[];
}

export function CalorAnalyticsChart({ data }: CalorAnalyticsChartProps) {
  // Group by calor level
  const groupedData = useMemo(() => {
    const hot = data.filter(d => d.calor >= 7);
    const warm = data.filter(d => d.calor >= 4 && d.calor < 7);
    const cold = data.filter(d => d.calor < 4);

    return [
      {
        name: "Quente (7-10)",
        count: hot.reduce((sum, d) => sum + d.count, 0),
        value: hot.reduce((sum, d) => sum + d.value, 0),
        color: "#EF4444", // destructive
        icon: "🔥",
      },
      {
        name: "Morno (4-6)",
        count: warm.reduce((sum, d) => sum + d.count, 0),
        value: warm.reduce((sum, d) => sum + d.value, 0),
        color: "#F59E0B", // chart-5 amber
        icon: "🌡️",
      },
      {
        name: "Frio (0-3)",
        count: cold.reduce((sum, d) => sum + d.count, 0),
        value: cold.reduce((sum, d) => sum + d.value, 0),
        color: "#94A3B8", // muted
        icon: "❄️",
      },
    ].filter(item => item.count > 0);
  }, [data]);

  const totalCount = groupedData.reduce((sum, d) => sum + d.count, 0);
  const totalValue = groupedData.reduce((sum, d) => sum + d.value, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  if (groupedData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Flame className="w-12 h-12 mb-4 opacity-20" />
        <p>Nenhuma proposta ativa</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={groupedData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="count"
              label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {groupedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number, name: string, props: any) => [
                `${value} propostas (${formatCurrency(props.payload.value)})`,
                props.payload.name
              ]}
            />
            <Legend 
              formatter={(value, entry: any) => (
                <span className="text-sm">
                  {entry.payload?.icon} {value}
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
        {groupedData.map((item, index) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="p-3 rounded-lg border text-center"
            style={{ borderColor: `${item.color}30`, backgroundColor: `${item.color}10` }}
          >
            <div className="text-2xl mb-1">{item.icon}</div>
            <p className="text-lg font-bold" style={{ color: item.color }}>
              {item.count}
            </p>
            <p className="text-xs text-muted-foreground">propostas</p>
            <p className="text-xs font-medium mt-1" style={{ color: item.color }}>
              {formatCurrency(item.value)}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Total Summary */}
      <div className="p-4 rounded-lg bg-muted/30 border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Total em Pipeline</p>
            <p className="text-lg font-bold">{totalCount} propostas</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Valor Total</p>
            <p className="text-lg font-bold text-success">{formatCurrency(totalValue)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
