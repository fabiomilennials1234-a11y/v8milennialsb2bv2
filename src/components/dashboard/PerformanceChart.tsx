import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  isSameDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";

interface DailyData {
  date: string;
  day: string;
  leads: number;
  meetings: number;
  sales: number;
  revenue: number;
}

function usePerformanceData(month: number, year: number) {
  const startDate = startOfMonth(new Date(year, month - 1));
  const endDate = endOfMonth(new Date(year, month - 1));
  const today = new Date();

  return useQuery({
    queryKey: ["performance-chart", month, year],
    queryFn: async (): Promise<DailyData[]> => {
      const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });

      // Get all leads
      const { data: leads } = await supabase
        .from("leads")
        .select("created_at")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      // Get all meetings compareceu
      const { data: meetings } = await supabase
        .from("pipe_confirmacao")
        .select("updated_at")
        .eq("status", "compareceu")
        .gte("updated_at", startDate.toISOString())
        .lte("updated_at", endDate.toISOString());

      // Get all sales
      const { data: sales } = await supabase
        .from("pipe_propostas")
        .select("closed_at, sale_value")
        .eq("status", "vendido")
        .gte("closed_at", startDate.toISOString())
        .lte("closed_at", endDate.toISOString());

      return daysInMonth
        .filter((day) => day <= today)
        .map((day) => {
          const dayLeads = leads?.filter((l) =>
            isSameDay(new Date(l.created_at), day)
          ).length || 0;

          const dayMeetings = meetings?.filter((m) =>
            isSameDay(new Date(m.updated_at), day)
          ).length || 0;

          const daySales = sales?.filter((s) =>
            isSameDay(new Date(s.closed_at), day)
          ) || [];

          const dayRevenue = daySales.reduce(
            (sum, s) => sum + (Number(s.sale_value) || 0),
            0
          );

          return {
            date: format(day, "yyyy-MM-dd"),
            day: format(day, "dd", { locale: ptBR }),
            leads: dayLeads,
            meetings: dayMeetings,
            sales: daySales.length,
            revenue: dayRevenue,
          };
        });
    },
  });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium mb-2">Dia {label}</p>
        {payload.map((entry: any, index: number) => (
          <p
            key={index}
            className="text-xs"
            style={{ color: entry.color }}
          >
            {entry.name}: {entry.name === "Receita" 
              ? `R$ ${entry.value.toLocaleString("pt-BR")}`
              : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export function PerformanceChart() {
  const now = new Date();
  const { data, isLoading } = usePerformanceData(
    now.getMonth() + 1,
    now.getFullYear()
  );

  // Calculate cumulative revenue
  const chartData = useMemo(() => {
    if (!data) return [];
    let cumulative = 0;
    return data.map((d) => {
      cumulative += d.revenue;
      return { ...d, cumulativeRevenue: cumulative };
    });
  }, [data]);

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  return (
    <Tabs defaultValue="activity" className="w-full">
      <TabsList className="grid w-full max-w-xs grid-cols-2 mb-4">
        <TabsTrigger value="activity">Atividade</TabsTrigger>
        <TabsTrigger value="revenue">Receita</TabsTrigger>
      </TabsList>

      <TabsContent value="activity">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="h-[280px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                tickLine={false}
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                className="text-muted-foreground"
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="leads"
                name="Leads"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="meetings"
                name="Reuniões"
                fill="hsl(var(--chart-2))"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="sales"
                name="Vendas"
                fill="hsl(var(--success))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </TabsContent>

      <TabsContent value="revenue">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="h-[280px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--success))"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--success))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                tickLine={false}
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  `R$ ${(value / 1000).toFixed(0)}k`
                }
                className="text-muted-foreground"
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="cumulativeRevenue"
                name="Receita"
                stroke="hsl(var(--success))"
                fillOpacity={1}
                fill="url(#colorRevenue)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      </TabsContent>
    </Tabs>
  );
}
