import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MetricUnit } from "@/modules/analytics/lib/metrics-studio-catalog";
import { formatMetricValue } from "@/modules/analytics/lib/metrics-studio-catalog";
import type { SamplePoint } from "@/modules/analytics/lib/metrics-studio-sample";
import { StudioTooltip } from "./StudioTooltip";

interface StudioCandleChartProps {
  series: SamplePoint[];
  unit: MetricUnit;
  compact: boolean;
}

const UP = "hsl(160 72% 45%)";
const DOWN = "hsl(0 72% 58%)";

const PAD = { top: 10, right: 8, bottom: 18, left: 8 };
const AXIS_W = 54;

/**
 * Vela (OHLC) desenhada à mão em SVG.
 *
 * Recharts não tem candlestick — as receitas que circulam empilham `Bar` com
 * base falsa e quebram em série com low = 0. Aqui a escala é explícita, o corpo
 * tem altura mínima de 1px (bucket de doji continua visível) e o hover é por
 * faixa vertical, não por elemento, então acertar a vela fina não vira teste
 * de pontaria.
 */
export function StudioCandleChart({ series, unit, compact }: StudioCandleChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setHover(null), [series]);

  const axisWidth = compact ? 0 : AXIS_W;
  const plotW = Math.max(0, size.width - PAD.left - PAD.right - axisWidth);
  const plotH = Math.max(0, size.height - PAD.top - PAD.bottom);

  const lows = series.map((p) => p.low);
  const highs = series.map((p) => p.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || Math.max(1, max * 0.1);
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;

  const yOf = useCallback(
    (value: number) => PAD.top + plotH - ((value - lo) / (hi - lo)) * plotH,
    [plotH, lo, hi],
  );

  const slot = series.length ? plotW / series.length : 0;
  const bodyW = Math.max(3, Math.min(18, slot * 0.58));

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!slot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - PAD.left - axisWidth;
      const index = Math.floor(x / slot);
      setHover(index >= 0 && index < series.length ? index : null);
    },
    [slot, series.length, axisWidth],
  );

  const ticks = compact ? [] : [hi, lo + (hi - lo) / 2, lo];
  // No máximo ~7 rótulos no eixo x, independente do tamanho da série.
  const tickEvery = Math.max(1, Math.ceil(series.length / 7));
  const point = hover !== null ? series[hover] : null;

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {size.width > 0 && (
        <svg width={size.width} height={size.height} className="block overflow-visible">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left + axisWidth}
                x2={size.width - PAD.right}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke="hsl(var(--border))"
                strokeOpacity={0.4}
                strokeDasharray="2 4"
              />
              <text
                x={PAD.left + axisWidth - 8}
                y={yOf(tick) + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {formatMetricValue(tick, unit)}
              </text>
            </g>
          ))}

          {series.map((p, i) => {
            const cx = PAD.left + axisWidth + slot * i + slot / 2;
            const rising = p.close >= p.open;
            const color = rising ? UP : DOWN;
            const yTop = yOf(Math.max(p.open, p.close));
            const yBottom = yOf(Math.min(p.open, p.close));
            const bodyH = Math.max(1, yBottom - yTop);
            const active = hover === i;

            return (
              <g key={p.label} opacity={hover === null || active ? 1 : 0.42}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={yOf(p.high)}
                  y2={yOf(p.low)}
                  stroke={color}
                  strokeWidth={1}
                  strokeLinecap="round"
                />
                <rect
                  x={cx - bodyW / 2}
                  y={yTop}
                  width={bodyW}
                  height={bodyH}
                  rx={1.5}
                  fill={color}
                  fillOpacity={rising ? 0.9 : 0.85}
                />
                {!compact && i % tickEvery === 0 && (
                  <text
                    x={cx}
                    y={size.height - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px] tabular-nums"
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {point && (
        <div
          className="absolute top-1 z-10"
          style={{
            left: Math.min(
              Math.max(0, PAD.left + axisWidth + slot * (hover ?? 0) - 60),
              Math.max(0, size.width - 168),
            ),
          }}
        >
          <StudioTooltip
            title={point.label}
            unit={unit}
            rows={[
              { label: "Abertura", value: point.open },
              { label: "Máxima", value: point.high },
              { label: "Mínima", value: point.low },
              { label: "Fechamento", value: point.close, swatch: point.close >= point.open ? UP : DOWN },
            ]}
          />
        </div>
      )}
    </div>
  );
}
