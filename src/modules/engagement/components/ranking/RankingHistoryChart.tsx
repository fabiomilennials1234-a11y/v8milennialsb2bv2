import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, History } from "lucide-react";

// Tooltip do recharts no vocabulário V5: superfície de cartão, raio de 12 px.
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--card-border))",
  borderRadius: "12px",
  boxShadow: "var(--relevo)",
  color: "hsl(var(--card-foreground))",
};

interface RankingHistoryChartProps {
  data: Array<{
    month: string;
    position: number;
    sales: number;
  }>;
  memberName: string;
}

export function RankingHistoryChart({ data, memberName }: RankingHistoryChartProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/60">
            <History className="h-4 w-4" strokeWidth={2.2} />
          </span>
          Histórico de {memberName}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 12 }} 
                className="text-muted-foreground"
              />
              <YAxis 
                yAxisId="left"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                reversed
                domain={[1, 10]}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <Tooltip 
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="sales" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))' }}
                name="Vendas (R$)"
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="position" 
                stroke="hsl(var(--success))" 
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--success))' }}
                name="Posição"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface MonthlyComparisonProps {
  months: Array<{
    name: string;
    closers: Array<{ name: string; value: number }>;
  }>;
}

export function MonthlyRankingComparison({ months }: MonthlyComparisonProps) {
  // Transform data for chart
  const chartData = months.map(month => {
    const data: Record<string, any> = { month: month.name };
    month.closers.forEach(closer => {
      data[closer.name] = closer.value;
    });
    return data;
  });

  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--success))",
    "hsl(var(--chart-5))",
    "hsl(var(--chart-4))",
    "hsl(var(--destructive))",
  ];

  const closerNames = months[0]?.closers.map(c => c.name) || [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/60">
            <TrendingUp className="h-4 w-4" strokeWidth={2.2} />
          </span>
          Comparativo Mensal
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 12 }} 
                className="text-muted-foreground"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                tickFormatter={(value) => `R$ ${(value / 1000).toFixed(0)}K`}
              />
              <Tooltip 
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
              />
              <Legend />
              {closerNames.map((name, index) => (
                <Line 
                  key={name}
                  type="monotone" 
                  dataKey={name}
                  stroke={colors[index % colors.length]} 
                  strokeWidth={2}
                  dot={{ fill: colors[index % colors.length] }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
