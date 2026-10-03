/** PROTOTYPE — wipe me. Tiny visual helpers shared by the variants. */
import type { Health } from "./data";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export const healthColor: Record<Health, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  down: "text-red-400",
};
export const healthBg: Record<Health, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  down: "bg-red-400",
};
export const sevText: Record<string, string> = {
  ok: "text-emerald-400", warn: "text-amber-400", down: "text-red-400",
  info: "text-sky-400", critical: "text-red-400", warning: "text-amber-400",
};
export const sevDot: Record<string, string> = {
  ok: "bg-emerald-400", warn: "bg-amber-400", down: "bg-red-400",
  info: "bg-sky-400", critical: "bg-red-400", warning: "bg-amber-400",
};

export function Dot({ s }: { s: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${sevDot[s] ?? "bg-zinc-500"}`} />;
}

export function Trend({ t }: { t: "up" | "down" | "flat" }) {
  if (t === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-red-400" />;
  if (t === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-emerald-400" />;
  return <Minus className="h-3.5 w-3.5 text-zinc-500" />;
}

export function Spark({ data, className = "" }: { data: number[]; className?: string }) {
  const max = Math.max(...data, 1);
  const w = 100, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Bars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm bg-amber-400/70" style={{ height: `${Math.max((v / max) * 100, 3)}%` }} title={`${v}`} />
      ))}
    </div>
  );
}

export const ago = (min: number) => (min < 60 ? `há ${min}min` : `há ${Math.floor(min / 60)}h`);
