import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";
import { StudioTooltip } from "./StudioTooltip";

interface StudioLineChartProps {
  /** Já ordenada cronologicamente por quem chama — o motor devolve por valor. */
  series: MetricSeriesPoint[];
  formatId: string;
  /** Abaixo de ~200px de altura os eixos viram ruído. */
  compact: boolean;
}

/**
 * Cor do traço: token do design system, não valor solto — é a mesma gramática
 * dos gráficos do Comando (`PerformanceChart`, `MetaComparativeChart`), que
 * usam `hsl(var(--primary))` / `--chart-2` / `--success`. Trocar de tema (ou o
 * accent gold mudar) leva o Estúdio junto, sem tocar aqui.
 *
 * `STUDIO_PALETTE[0]` continua servindo a pizza, onde as fatias precisam de uma
 * escala categórica — ali o token único não resolve.
 */
const ACCENT = "hsl(var(--primary))";

export function StudioLineChart({ series, formatId, compact }: StudioLineChartProps) {
  // `useId` devolve ":r0:" — dois-pontos é reservado para namespace em XML e
  // quebra o `url(#…)` do fill em parte dos engines. Tira antes de usar.
  const gradientId = `studio-grad-${useId().replace(/:/g, "")}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: compact ? 0 : -14 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Malha na horizontal apenas: linha vertical em série temporal
            compete com o próprio traço e não ajuda a ler valor. Mesma escolha
            dos gráficos do Comando.

            NÃO fica atrás de `compact`. Os EIXOS somem na janela pequena
            porque viram ruído de texto; a malha não tem texto e é justamente o
            que permite estimar valor quando o eixo Y não está lá. Escondê-la
            junto foi engano meu na primeira versão — a janela pequena era
            exatamente onde ela mais servia. */}
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="hsl(var(--border))"
          strokeOpacity={compact ? 0.3 : 0.45}
        />

        {!compact && (
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
            dy={4}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
        )}
        {!compact && (
          <YAxis
            width={52}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: number) => formatMetricValue(v, formatId)}
            // Sem esta folga o maior valor encosta no topo e a área fica
            // cortada — o gráfico parece truncado mesmo com o dado inteiro.
            domain={[0, "auto"]}
          />
        )}

        <Tooltip
          cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <StudioTooltip
                title={String(label)}
                formatId={formatId}
                rows={[{ label: "Valor", value: Number(payload[0].value), swatch: ACCENT }]}
              />
            ) : null
          }
        />

        <Area
          type="monotone"
          dataKey="value"
          stroke={ACCENT}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          // Anel na cor do fundo separa o ponto ativo da área embaixo dele —
          // sem ele o marcador some no gradiente em valores altos.
          activeDot={{ r: 3.5, strokeWidth: 2, stroke: "hsl(var(--background))", fill: ACCENT }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
