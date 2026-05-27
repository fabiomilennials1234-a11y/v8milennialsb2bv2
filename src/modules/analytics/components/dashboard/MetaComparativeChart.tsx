import { memo, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target } from "lucide-react";

interface Props {
  dailySales: Array<{ day: string; revenue: number; count: number }>;
  goalTarget: number;
  month: number;
  year: number;
}

function MetaComparativeChartBase({ dailySales, goalTarget, month, year }: Props) {
  const chartData = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(year, month, 0).getDate();
    const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
    const maxDay = isCurrentMonth ? now.getDate() : daysInMonth;
    const dailyTarget = goalTarget / daysInMonth;

    // Map dailySales by day
    const salesMap = new Map<string, number>();
    dailySales.forEach(d => {
      const dayNum = new Date(d.day).getDate().toString().padStart(2, "0");
      salesMap.set(dayNum, (salesMap.get(dayNum) || 0) + d.revenue);
    });

    let cumulativeActual = 0;
    const data = [];
    for (let d = 1; d <= maxDay; d++) {
      const dayStr = d.toString().padStart(2, "0");
      const dayRevenue = salesMap.get(dayStr) || 0;
      cumulativeActual += dayRevenue;
      const expected = dailyTarget * d;
      data.push({ day: dayStr, expected: Math.round(expected), actual: Math.round(cumulativeActual) });
    }
    return data;
  }, [dailySales, goalTarget, month, year]);

  const fmt = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Meta Esperada vs Realizado
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: 12 }}
                formatter={(v: number, name: string) => [fmt(v), name === "expected" ? "Meta esperada" : "Realizado"]}
                labelFormatter={(l) => `Dia ${l}`}
              />
              <Area type="monotone" dataKey="expected" name="expected" stroke="hsl(var(--destructive))" strokeDasharray="5 5" fillOpacity={0} strokeWidth={1.5} />
              <Area type="monotone" dataKey="actual" name="actual" stroke="hsl(var(--success))" fill="url(#gradActual)" fillOpacity={1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export const MetaComparativeChart = memo(MetaComparativeChartBase);
