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
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";

export function WeeklyChart() {
  const { data: chartData, isLoading } = useQuery({
    queryKey: ["weekly-performance"],
    queryFn: async () => {
      const days = 7;
      const data = [];

      for (let i = days - 1; i >= 0; i--) {
        const date = subDays(new Date(), i);
        const dayStart = startOfDay(date).toISOString();
        const dayEnd = endOfDay(date).toISOString();

        // Leads created
        const { count: leads } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .gte("created_at", dayStart)
          .lte("created_at", dayEnd);

        // Meetings scheduled
        const { count: meetings } = await supabase
          .from("pipe_confirmacao")
          .select("*", { count: "exact", head: true })
          .gte("meeting_date", dayStart)
          .lte("meeting_date", dayEnd);

        // Meetings attended
        const { count: attended } = await supabase
          .from("pipe_confirmacao")
          .select("*", { count: "exact", head: true })
          .eq("status", "compareceu")
          .gte("meeting_date", dayStart)
          .lte("meeting_date", dayEnd);

        // Sales closed
        const { count: sales } = await supabase
          .from("pipe_propostas")
          .select("*", { count: "exact", head: true })
          .eq("status", "vendido")
          .gte("closed_at", dayStart)
          .lte("closed_at", dayEnd);

        data.push({
          date: format(date, "EEE", { locale: ptBR }),
          fullDate: format(date, "dd/MM"),
          leads: leads || 0,
          meetings: meetings || 0,
          attended: attended || 0,
          sales: sales || 0,
        });
      }

      return data;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Performance Semanal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Performance Semanal
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorMeetings" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelFormatter={(label, payload) => {
                if (payload && payload[0]) {
                  return payload[0].payload.fullDate;
                }
                return label;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "12px" }}
              iconType="circle"
            />
            <Area
              type="monotone"
              dataKey="leads"
              name="Leads"
              stroke="hsl(var(--primary))"
              fillOpacity={1}
              fill="url(#colorLeads)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="attended"
              name="Reuniões"
              stroke="hsl(var(--chart-5))"
              fillOpacity={1}
              fill="url(#colorMeetings)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="sales"
              name="Vendas"
              stroke="hsl(var(--success))"
              fillOpacity={1}
              fill="url(#colorSales)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
