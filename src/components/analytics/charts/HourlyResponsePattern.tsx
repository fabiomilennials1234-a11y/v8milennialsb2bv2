import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { type HourlyPatternRow } from "@/hooks/useAnalyticsEngajamento";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  data: HourlyPatternRow[];
}

// Fill all 24h so the chart always looks complete
function buildFullDay(data: HourlyPatternRow[]): HourlyPatternRow[] {
  const map = new Map(data.map((d) => [d.hour, d]));
  return Array.from({ length: 24 }, (_, h) =>
    map.get(h) ?? { hour: h, response_count: 0, response_rate: 0 },
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string | number;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const count = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-medium">{label}h</p>
      <p className="text-muted-foreground">
        {count} mensagens recebidas
      </p>
    </div>
  );
}

export function HourlyResponsePattern({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Clock className="h-4 w-4" />
            Padrão de Resposta por Hora
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de mensagens no período"
            detail="As mensagens WhatsApp aparecerão aqui quando disponíveis."
          />
        </CardContent>
      </Card>
    );
  }

  const full = buildFullDay(data);
  const maxCount = Math.max(...full.map((d) => d.response_count), 1);

  // Find peak hours
  const sorted = [...data].sort((a, b) => b.response_count - a.response_count);
  const topPeak = sorted[0];
  const morningHours = data.filter((d) => d.hour >= 8 && d.hour < 12);
  const afternoonHours = data.filter((d) => d.hour >= 12 && d.hour < 18);
  const peakMorning = morningHours.sort((a, b) => b.response_count - a.response_count)[0];
  const peakAfternoon = afternoonHours.sort((a, b) => b.response_count - a.response_count)[0];
  const worstHour = sorted[sorted.length - 1];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Clock className="h-4 w-4" />
          Padrão de Resposta por Hora
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Em quais horários os clientes mais respondem
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={full} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `${v}h`}
              interval={3}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="response_count" radius={[2, 2, 0, 0]}>
              {full.map((entry) => {
                const isPeak =
                  topPeak && entry.hour === topPeak.hour && entry.response_count > 0;
                const isHigh =
                  maxCount > 0 && entry.response_count >= maxCount * 0.7;
                const fill = isPeak
                  ? "hsl(var(--chart-2))"
                  : isHigh
                  ? "hsl(142, 76%, 36%)"
                  : "hsl(var(--muted-foreground) / 0.4)";
                return <Cell key={entry.hour} fill={fill} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">Pico manhã</p>
            <p className="text-sm font-semibold">
              {peakMorning ? `${peakMorning.hour}h` : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">Pico tarde</p>
            <p className="text-sm font-semibold">
              {peakAfternoon ? `${peakAfternoon.hour}h` : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">Menor resposta</p>
            <p className="text-sm font-semibold">
              {worstHour ? `${worstHour.hour}h` : "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
