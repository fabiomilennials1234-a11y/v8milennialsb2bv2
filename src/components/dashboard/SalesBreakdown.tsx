import { useMemo } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChartIcon, TrendingUp } from "lucide-react";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";

export function SalesBreakdown() {
  const now = new Date();
  const { data: metrics, isLoading } = useDashboardMetrics(now.getMonth() + 1, now.getFullYear());

  const data = useMemo(() => {
    if (!metrics) return [];
    
    return [
      { name: "MRR", value: metrics.vendaMRR, color: "hsl(var(--chart-5))" },
      { name: "Projeto", value: metrics.vendaProjeto, color: "hsl(var(--primary))" },
    ].filter(d => d.value > 0);
  }, [metrics]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toLocaleString("pt-BR")}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-primary" />
            Breakdown de Vendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const totalVendas = metrics?.vendaTotal || 0;
  const mrrPercent = totalVendas > 0 ? ((metrics?.vendaMRR || 0) / totalVendas * 100).toFixed(0) : 0;
  const projetoPercent = totalVendas > 0 ? ((metrics?.vendaProjeto || 0) / totalVendas * 100).toFixed(0) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChartIcon className="w-4 h-4 text-primary" />
          Breakdown de Vendas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="flex items-center gap-4">
            <div className="w-32 h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            <div className="flex-1 space-y-3">
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-3 rounded-lg bg-chart-5/10"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">MRR</span>
                  <span className="text-xs text-muted-foreground">{mrrPercent}%</span>
                </div>
                <p className="text-lg font-bold text-chart-5">
                  {formatCurrency(metrics?.vendaMRR || 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Ticket médio: {formatCurrency(metrics?.ticketMedioMRR || 0)}
                </p>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="p-3 rounded-lg bg-primary/10"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Projeto</span>
                  <span className="text-xs text-muted-foreground">{projetoPercent}%</span>
                </div>
                <p className="text-lg font-bold text-primary">
                  {formatCurrency(metrics?.vendaProjeto || 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Ticket médio: {formatCurrency(metrics?.ticketMedioProjeto || 0)}
                </p>
              </motion.div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma venda registrada este mês</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
