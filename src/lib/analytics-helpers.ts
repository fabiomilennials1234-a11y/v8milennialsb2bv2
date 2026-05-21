export type DeltaDirection = "up" | "down" | "neutral";

export interface KPIDelta {
  delta: number;
  direction: DeltaDirection;
}

export function deriveKPIDelta(current: number, previous: number): KPIDelta {
  if (previous === 0) return { delta: 0, direction: "neutral" };
  const pct = Math.round(Math.abs((current - previous) / previous) * 100);
  if (current > previous) return { delta: pct, direction: "up" };
  if (current < previous) return { delta: pct, direction: "down" };
  return { delta: 0, direction: "neutral" };
}

const MONTH_ABBR: Record<string, string> = {
  "01": "jan", "02": "fev", "03": "mar", "04": "abr",
  "05": "mai", "06": "jun", "07": "jul", "08": "ago",
  "09": "set", "10": "out", "11": "nov", "12": "dez",
};

export interface RevenuePoint {
  month: string;
  approved: number;
  pending: number;
}

export function formatRevenueData(
  raw: { month: string; approved: number; pending: number }[],
): RevenuePoint[] {
  return raw.map((r) => ({
    month: MONTH_ABBR[r.month.slice(5, 7)] ?? r.month,
    approved: r.approved,
    pending: r.pending,
  }));
}

export function generateSparklinePath(
  points: number[],
  width: number,
  height: number,
): string {
  if (points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);

  return points
    .map((v, i) => {
      const x = Math.round(i * step);
      const y = Math.round(height - ((v - min) / range) * height);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}
