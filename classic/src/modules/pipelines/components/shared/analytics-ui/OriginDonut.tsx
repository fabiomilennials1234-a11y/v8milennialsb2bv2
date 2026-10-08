import { MapPin } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ORIGIN_COLORS, CHART_TOOLTIP_STYLE } from "../analytics-utils";

export interface OriginSlice {
  name: string;
  value: number;
}

interface OriginDonutProps {
  slices: OriginSlice[];
  /** Unidade do total central e do tooltip ("leads", "reuniões"). */
  unit: string;
}

/** Donut de distribuição por origem — total no centro + legenda tabular. */
export function OriginDonut({ slices, unit }: OriginDonutProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (slices.length === 0 || total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-52 text-muted-foreground">
        <MapPin className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm">Nenhum registro no período</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-8">
      <div className="relative w-[168px] h-[168px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={76}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {slices.map((_, index) => (
                <Cell key={index} fill={ORIGIN_COLORS[index % ORIGIN_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [`${value} ${unit}`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[26px] font-extrabold tabular-nums tracking-tight">{total}</span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <div className="flex-1 w-full space-y-3 min-w-0">
        {slices.slice(0, 6).map((slice, i) => (
          <div key={slice.name} className="grid grid-cols-[12px_1fr_auto_38px] items-center gap-2.5">
            <span
              className="w-[9px] h-[9px] rounded-[3px]"
              style={{ backgroundColor: ORIGIN_COLORS[i % ORIGIN_COLORS.length] }}
            />
            <span className="text-[13px] truncate">{slice.name}</span>
            <span className="text-[13px] font-bold tabular-nums">{slice.value}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums text-right">
              {((slice.value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
