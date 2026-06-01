import type { HealthSnapshot } from "@/modules/platform/hooks/useHealthHistory";

interface HealthSparklineProps {
  data: HealthSnapshot[];
  width?: number;
  height?: number;
  className?: string;
}

function sparkColor(scores: number[]) {
  const last = scores[scores.length - 1] ?? 0;
  if (last >= 80) return "#34d399";
  if (last >= 60) return "#fbbf24";
  return "#f87171";
}

export function HealthSparkline({
  data,
  width = 120,
  height = 32,
  className,
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

  const color = sparkColor(scores);
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
        aria-label={`Health trend: ${delta >= 0 ? "+" : ""}${delta} pts`}
      >
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
        <circle
          cx={points[points.length - 1].split(",")[0]}
          cy={points[points.length - 1].split(",")[1]}
          r={2}
          fill={color}
        />
      </svg>
      {Math.abs(delta) >= 1 && (
        <span
          className="text-[10px] font-medium tabular-nums"
          style={{ color }}
        >
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      )}
    </div>
  );
}
