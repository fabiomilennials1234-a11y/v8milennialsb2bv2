import { memo, useCallback, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHART_KIND_META,
  READINESS_META,
  formatMetricValue,
  type ChartKind,
  type StudioMetric,
} from "@/modules/analytics/lib/metrics-studio-catalog";
import { buildMetricSample } from "@/modules/analytics/lib/metrics-studio-sample";
import { GRID, MIN_H, MIN_W, type StudioWindow } from "@/modules/analytics/hooks/useMetricsStudio";
import { StudioCandleChart } from "./charts/StudioCandleChart";
import { StudioLineChart } from "./charts/StudioLineChart";
import { StudioPieChart } from "./charts/StudioPieChart";

interface MetricWindowProps {
  win: StudioWindow;
  metric: StudioMetric;
  periodKey: string;
  selected: boolean;
  canvas: { width: number; height: number };
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onChart: (id: string, chart: ChartKind) => void;
  onRemove: (id: string) => void;
}

type Handle = "e" | "s" | "se";

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const snap = (n: number) => Math.round(n / GRID) * GRID;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

function MetricWindowBase({
  win, metric, periodKey, selected, canvas,
  onSelect, onMove, onResize, onChart, onRemove,
}: MetricWindowProps) {
  // Geometria em trânsito fica LOCAL: `usePersistedState` grava em localStorage
  // a cada mudança, e commitar por pointermove picotaria o arrasto. O parent só
  // recebe o valor final, no pointerup.
  const [draft, setDraft] = useState<Geometry | null>(null);
  const origin = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 });
  // Espelho do draft para ler no `pointerup` do resize: o handler vive em
  // listener de window, fora do ciclo de render, e commitar de dentro de um
  // updater de estado dispararia o efeito duas vezes em StrictMode.
  const draftRef = useRef<Geometry | null>(null);

  const applyDraft = useCallback((next: Geometry | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const geo = draft ?? win;
  const sample = useMemo(() => buildMetricSample(metric, periodKey), [metric, periodKey]);
  const readiness = READINESS_META[metric.readiness];

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      origin.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
      applyDraft({ x: win.x, y: win.y, w: win.w, h: win.h });
      onSelect(win.id);
    },
    [win, onSelect, applyDraft],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draftRef.current) return;
      const o = origin.current;
      applyDraft({
        ...draftRef.current,
        x: clamp(snap(o.x + e.clientX - o.px), 0, Math.max(0, canvas.width - o.w)),
        y: clamp(snap(o.y + e.clientY - o.py), 0, Math.max(0, canvas.height - o.h)),
      });
    },
    [canvas, applyDraft],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const current = draftRef.current;
      if (!current) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      onMove(win.id, current.x, current.y);
      applyDraft(null);
    },
    [win.id, onMove, applyDraft],
  );

  const startResize = useCallback(
    (handle: Handle) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      origin.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
      applyDraft({ x: win.x, y: win.y, w: win.w, h: win.h });
      onSelect(win.id);

      const move = (ev: PointerEvent) => {
        const o = origin.current;
        const nextW = handle === "s" ? o.w : clamp(snap(o.w + ev.clientX - o.px), MIN_W, Math.max(MIN_W, canvas.width - o.x));
        const nextH = handle === "e" ? o.h : clamp(snap(o.h + ev.clientY - o.py), MIN_H, Math.max(MIN_H, canvas.height - o.y));
        applyDraft({ x: o.x, y: o.y, w: nextW, h: nextH });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const current = draftRef.current;
        if (current) onResize(win.id, current.w, current.h);
        applyDraft(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [win, canvas, onSelect, onResize, applyDraft],
  );

  const compact = geo.h < 210 || geo.w < 300;
  const rising = sample.deltaPct >= 0;

  return (
    <div
      role="group"
      aria-label={metric.label}
      onPointerDown={() => onSelect(win.id)}
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: win.z }}
      className={cn(
        "group absolute flex flex-col overflow-hidden rounded-xl border bg-card/95 backdrop-blur-sm",
        "transition-[box-shadow,border-color] duration-150",
        selected
          ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/.25),0_18px_50px_-12px_hsl(0_0%_0%/.55)]"
          : "border-border/70 shadow-[0_10px_30px_-16px_hsl(0_0%_0%/.6)] hover:border-border",
        draft && "select-none",
      )}
    >
      {/* Header — também é a alça de arrasto. */}
      <div
        onPointerDown={startDrag}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-grab items-start gap-2 border-b border-border/50 px-3 py-2 active:cursor-grabbing"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", readiness.dot)}
              title={`${readiness.label} — ${readiness.hint}`}
            />
            <h3 className="truncate text-[12px] font-semibold tracking-[-0.01em]">{metric.label}</h3>
          </div>
          {!compact && (
            <p className="truncate text-[10px] text-muted-foreground/70">{metric.description}</p>
          )}
        </div>

        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(win.id)}
          aria-label={`Remover ${metric.label}`}
          className="rounded-md p-1 text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Corpo */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-extrabold tracking-[-0.04em] tabular-nums">
            {formatMetricValue(sample.value, metric.unit)}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
              rising ? "text-emerald-500" : "text-destructive",
            )}
          >
            {rising ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(sample.deltaPct).toFixed(1)}%
          </span>
        </div>

        {win.chart !== "number" && (
          <div className="min-h-0 flex-1">
            {win.chart === "line" && (
              <StudioLineChart series={sample.series} unit={metric.unit} compact={compact} />
            )}
            {win.chart === "pie" && (
              <StudioPieChart slices={sample.slices} unit={metric.unit} compact={compact} />
            )}
            {win.chart === "candle" && (
              <StudioCandleChart series={sample.series} unit={metric.unit} compact={compact} />
            )}
          </div>
        )}
      </div>

      {/* Seletor de gráfico — aparece ao selecionar a janela ou no hover. */}
      <div
        className={cn(
          "flex items-center gap-1 border-t border-border/50 px-2 py-1.5 transition-opacity duration-150",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {metric.charts.map((kind) => (
          <button
            key={kind}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onChart(win.id, kind)}
            aria-pressed={win.chart === kind}
            className={cn(
              "rounded-md px-2 py-1 text-[10px] font-semibold transition-colors",
              win.chart === kind
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {CHART_KIND_META[kind].label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[9px] uppercase tracking-[0.08em] text-muted-foreground/40">
          amostra
        </span>
      </div>

      {/* Alças de redimensionamento */}
      <div
        onPointerDown={startResize("e")}
        className="absolute inset-y-3 right-0 w-1.5 cursor-ew-resize"
        aria-hidden
      />
      <div
        onPointerDown={startResize("s")}
        className="absolute inset-x-3 bottom-0 h-1.5 cursor-ns-resize"
        aria-hidden
      />
      <div
        onPointerDown={startResize("se")}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        aria-hidden
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/35">
          <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
}

export const MetricWindow = memo(MetricWindowBase);
