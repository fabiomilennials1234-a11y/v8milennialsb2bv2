import { motion } from "framer-motion";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, PieChart as PieChartIcon, BarChart3 } from "lucide-react";

interface CommissionBreakdownProps {
  data: {
    mrr: number;
    projeto: number;
    oteBase: number;
    bonus: number;
  };
}

export function CommissionBreakdown({ data }: CommissionBreakdownProps) {
  const chartData = [
    { name: "OTE Base", value: data.oteBase, color: "hsl(var(--primary))" },
    { name: "Bônus OTE", value: data.bonus, color: "hsl(var(--success))" },
    { name: "Comissão MRR", value: data.mrr, color: "hsl(var(--chart-5))" },
    { name: "Comissão Projeto", value: data.projeto, color: "hsl(var(--chart-4))" },
  ];

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChartIcon className="w-4 h-4 text-primary" />
          Composição dos Ganhos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="h-[180px] w-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => [
                    `R$ ${value.toLocaleString('pt-BR')}`,
                    ''
                  ]}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-2">
            {chartData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm text-muted-foreground">{item.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium">
                    R$ {item.value.toLocaleString('pt-BR')}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({((item.value / total) * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MonthlyEarningsChartProps {
  data: Array<{
    month: string;
    earnings: number;
    goal: number;
  }>;
}

export function MonthlyEarningsChart({ data }: MonthlyEarningsChartProps) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Evolução Mensal
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
              />
              <Legend />
              <Bar 
                dataKey="earnings" 
                fill="hsl(var(--primary))" 
                radius={[4, 4, 0, 0]}
                name="Ganhos"
              />
              <Bar 
                dataKey="goal" 
                fill="hsl(var(--muted))" 
                radius={[4, 4, 0, 0]}
                name="Meta"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface EarningsProjectionProps {
  data: Array<{
    month: string;
    actual: number;
    projected: number;
  }>;
}

export function EarningsProjection({ data }: EarningsProjectionProps) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Projeção de Ganhos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorProjected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="actual" 
                stroke="hsl(var(--primary))" 
                fillOpacity={1}
                fill="url(#colorActual)"
                name="Realizado"
              />
              <Area 
                type="monotone" 
                dataKey="projected" 
                stroke="hsl(var(--success))" 
                strokeDasharray="5 5"
                fillOpacity={1}
                fill="url(#colorProjected)"
                name="Projetado"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
