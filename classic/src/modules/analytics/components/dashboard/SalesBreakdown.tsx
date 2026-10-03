import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChartIcon, TrendingUp } from "lucide-react";
import { useDashboardMetrics } from "@/modules/analytics/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * FIX-B (code review): quando a receita é CANÔNICA (isCanonicalRevenue), vendaTotal
 * é líquido de estorno na âncora sold_at (ADR-0017 §3), mas vendaMRR/vendaProjeto
 * seguem LEGADOS (âncora + atribuição por 5 chaves diferentes) — as duas metades
 * NÃO somam o total e o percentual combinado podia passar de 100%, contradizendo o
 * headline. Solução (opção a): no modo canônico, o breakdown vem de revenueByStream
 * (novo_negocio + carteira), que soma vendaTotal POR CONSTRUÇÃO (§2). No modo legado,
 * mantém o eixo Recorrência×Projeto original. Só a fonte de dados + rótulos mudam;
 * o layout visual é preservado.
 */

interface BreakdownPart {
  name: string;
  value: number;
  ticketLabel: string | null;
  ticketValue: number | null;
  color: string;
  bgClass: string;
  textClass: string;
}

function SalesBreakdownBase() {
  const now = new Date();
  const { data: metrics, isLoading } = useDashboardMetrics(now.getMonth() + 1, now.getFullYear());

  const isCanonical = metrics?.isCanonicalRevenue === true;

  const parts = useMemo<BreakdownPart[]>(() => {
    if (!metrics) return [];

    if (isCanonical) {
      // Eixo canônico: Novo Negócio × Carteira (streams). Soma == vendaTotal (§2).
      // Sem ticket por stream no leitor desta fatia — subtítulo omitido (não mentir).
      const stream = metrics.revenueByStream ?? { novoNegocio: 0, carteira: 0 };
      return [
        {
          name: "Novo Negócio",
          value: stream.novoNegocio,
          ticketLabel: null,
          ticketValue: null,
          color: "hsl(var(--chart-5))",
          bgClass: "bg-chart-5/10",
          textClass: "text-chart-5",
        },
        {
          name: "Carteira",
          value: stream.carteira,
          ticketLabel: null,
          ticketValue: null,
          color: "hsl(var(--primary))",
          bgClass: "bg-primary/10",
          textClass: "text-primary",
        },
      ];
    }

    // Legado (isCanonicalRevenue !== true): eixo product_type Recorrência × Projeto.
    return [
      {
        name: "Recorrência",
        value: metrics.vendaMRR,
        ticketLabel: "Ticket médio Rec.",
        ticketValue: metrics.ticketMedioMRR,
        color: "hsl(var(--chart-5))",
        bgClass: "bg-chart-5/10",
        textClass: "text-chart-5",
      },
      {
        name: "Projeto",
        value: metrics.vendaProjeto,
        ticketLabel: "Ticket médio",
        ticketValue: metrics.ticketMedioProjeto,
        color: "hsl(var(--primary))",
        bgClass: "bg-primary/10",
        textClass: "text-primary",
      },
    ];
  }, [metrics, isCanonical]);

  const chartData = useMemo(() => parts.filter((p) => p.value > 0), [parts]);

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
  const percentOf = (value: number) =>
    totalVendas > 0 ? ((value / totalVendas) * 100).toFixed(0) : "0";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChartIcon className="w-4 h-4 text-primary" />
          Breakdown de Vendas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <div className="flex items-center gap-4">
            <div className="w-32 h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
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
              {parts.map((part, index) => (
                <motion.div
                  key={part.name}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`p-3 rounded-lg ${part.bgClass}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{part.name}</span>
                    <span className="text-xs text-muted-foreground">{percentOf(part.value)}%</span>
                  </div>
                  <p className={`text-lg font-bold ${part.textClass}`}>
                    {formatCurrency(part.value)}
                  </p>
                  {part.ticketLabel && (
                    <p className="text-xs text-muted-foreground">
                      {part.ticketLabel}: {formatCurrency(part.ticketValue || 0)}
                    </p>
                  )}
                </motion.div>
              ))}
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

export const SalesBreakdown = memo(SalesBreakdownBase);
