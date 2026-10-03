import type { HealthSnapshot } from "@/modules/platform/hooks/useHealthHistory";

interface HealthSparklineProps {
  data: HealthSnapshot[];
  width?: number;
  height?: number;
  className?: string;
  /**
   * Força uma cor só (linha, ponto e delta). Sobre o cartão de ouro, verde e
   * vermelho viram ruído — lá a linha é da cor da tinta do próprio cartão.
   * Sem `color`, a cor segue a faixa do último ponto, como sempre foi.
   */
  color?: string;
}

/**
 * Mesmas faixas de antes (80/60), agora em token: o escuro deixa de quebrar.
 * O âmbar tem par próprio para texto — `--warning` cru reprova contraste como
 * letra sobre o cartão claro.
 */
function sparkColors(scores: number[]) {
  const last = scores[scores.length - 1] ?? 0;
  if (last >= 80) return { line: "hsl(var(--success))", text: "hsl(var(--success))" };
  if (last >= 60) return { line: "hsl(var(--warning))", text: "hsl(var(--warning-strong))" };
  return { line: "hsl(var(--destructive))", text: "hsl(var(--destructive))" };
}

export function HealthSparkline({
  data,
  width = 120,
  height = 32,
  className,
  color: colorOverride,
}: HealthSparklineProps) {
  if (data.length < 2) return null;

  const scores = data.map((d) => d.health_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const pad = 2;

  const points = scores.map((score, i) => {
    const x = (i / (scores.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((score - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const tones = sparkColors(scores);
  const color = colorOverride ?? tones.line;
  const textColor = colorOverride ?? tones.text;
  const first = scores[0];
  const last = scores[scores.length - 1];
  const delta = last - first;

  return (
    <div className={className}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        role="img"
        aria-label={`Tendência do health: ${delta >= 0 ? "+" : ""}${delta} pts`}
      >
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
        <circle
          cx={points[points.length - 1].split(",")[0]}
          cy={points[points.length - 1].split(",")[1]}
          r={2.25}
          fill={color}
        />
      </svg>
      {Math.abs(delta) >= 1 && (
        <span
          className="text-[10px] font-bold tabular-nums"
          style={{ color: textColor }}
        >
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      )}
    </div>
  );
}
