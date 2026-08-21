import { memo, useCallback, useRef, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHART_KIND_META, type ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import {
  ROTULO_DO_CORTE,
  cortesVisiveis,
  ehEscalar,
  type EngineMetric,
  type MetricRecorte,
} from "@/modules/analytics/lib/metrics-studio-engine-map";
import {
  variacaoPct,
  type StudioPeriod,
  type StudioRange,
} from "@/modules/analytics/lib/metrics-studio-period";
import { EM_DASH, formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import { headValueFromMeasure } from "@/modules/analytics/lib/tv-series";
import { useMetricWindowData } from "@/modules/analytics/hooks/useMetricWindowData";
import {
  GRID,
  MIN_H,
  MIN_W,
  graficosPara,
  type StudioWindow,
} from "@/modules/analytics/hooks/useMetricsStudio";
import { StudioLineChart } from "./charts/StudioLineChart";
import { StudioPieChart } from "./charts/StudioPieChart";

interface MetricWindowProps {
  win: StudioWindow;
  metric: EngineMetric;
  period: StudioPeriod;
  /** Só quando `period === "custom"` (SCRUM-313). */
  range?: StudioRange | null;
  podeVerPorPessoa: boolean;
  /** SCRUM-308: em Visualização a janela é só leitura. */
  editavel: boolean;
  selected: boolean;
  canvas: { width: number; height: number };
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onChart: (id: string, chart: ChartKind) => void;
  onCorte: (id: string, corte: MetricRecorte) => void;
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
  win, metric, period, range, podeVerPorPessoa, editavel, selected, canvas,
  onSelect, onMove, onResize, onChart, onCorte, onRemove,
}: MetricWindowProps) {
  // Geometria em trânsito fica LOCAL. Commitar por pointermove subiria cada
  // quadro do arrasto para o estado do painel — e, desde o SCRUM-309, isso
  // agenda gravação no servidor. O pai só recebe o valor final, no pointerup.
  const [draft, setDraft] = useState<Geometry | null>(null);
  const origin = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 });
  const draftRef = useRef<Geometry | null>(null);

  const applyDraft = useCallback((next: Geometry | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const geo = draft ?? win;
  const dados = useMetricWindowData(metric, win.corte, period, range);

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
  const cortes = cortesVisiveis(metric, podeVerPorPessoa);
  const graficos = graficosPara(metric, win.corte);
  const escalar = ehEscalar(metric, win.corte);

  // O motor DEGRADA o recorte em silêncio e reporta o efetivo. Se ele degradou,
  // o rótulo tem que dizer o que o número REALMENTE é — senão a janela mente.
  const corteEfetivo = (dados.medida?.recorte as MetricRecorte | undefined) ?? win.corte;
  const degradou = !escalar && corteEfetivo !== win.corte;

  const valor = headValueFromMeasure(dados.medida);
  const variacao = variacaoPct(valor, dados.valorAnterior);
  const subindo = (variacao ?? 0) >= 0;

  return (
    <div
      role="group"
      aria-label={metric.label}
      onPointerDown={editavel ? () => onSelect(win.id) : undefined}
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: win.z }}
      className={cn(
        "group absolute flex flex-col overflow-hidden rounded-xl border bg-card/95 backdrop-blur-sm",
        "transition-[box-shadow,border-color] duration-150",
        selected && editavel
          ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/.25),0_18px_50px_-12px_hsl(0_0%_0%/.55)]"
          : "border-border/70 shadow-[0_10px_30px_-16px_hsl(0_0%_0%/.6)] hover:border-border",
        draft && "select-none",
      )}
    >
      {/* Header — também é a alça de arrasto. */}
      <div
        onPointerDown={editavel ? startDrag : undefined}
        onPointerMove={editavel ? onDragMove : undefined}
        onPointerUp={editavel ? endDrag : undefined}
        onPointerCancel={editavel ? endDrag : undefined}
        className={cn(
          "flex items-start gap-2 border-b border-border/50 px-3 py-2",
          editavel && "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12px] font-semibold tracking-[-0.01em]">{metric.label}</h3>
          {!compact && (
            <p className="truncate text-[10px] text-muted-foreground/70">
              {ROTULO_DO_CORTE[corteEfetivo]}
              {degradou && " · sem funil escolhido"}
            </p>
          )}
        </div>

        {editavel && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onRemove(win.id)}
            aria-label={`Remover ${metric.label}`}
            className="rounded-md p-1 text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Corpo */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2">
        {dados.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : dados.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
            <AlertCircle className="h-4 w-4 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground/70">Não foi possível carregar</p>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dados.refetch()}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-extrabold tracking-[-0.04em] tabular-nums">
                {formatMetricValue(valor, metric.formatId)}
              </span>
              {variacao !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
                    subindo ? "text-emerald-500" : "text-destructive",
                  )}
                  title="Comparado ao período anterior"
                >
                  {subindo ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(variacao).toFixed(1)}%
                </span>
              )}
            </div>

            {win.chart !== "number" && (
              <div className="min-h-0 flex-1">
                {dados.series.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <span className="text-[11px] text-muted-foreground/50">
                      Sem dado no período {EM_DASH}
                    </span>
                  </div>
                ) : win.chart === "line" ? (
                  <StudioLineChart series={dados.series} formatId={metric.formatId} compact={compact} />
                ) : (
                  <StudioPieChart slices={dados.series} formatId={metric.formatId} compact={compact} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Controles — só em Edição, ao selecionar a janela ou no hover. */}
      {editavel && (
      <div
        className={cn(
          "flex items-center gap-1 overflow-x-auto border-t border-border/50 px-2 py-1.5 scrollbar-hide transition-opacity duration-150",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {cortes.length > 1 && (
          <select
            value={win.corte}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onCorte(win.id, e.target.value as MetricRecorte)}
            aria-label="Corte do dado"
            className="shrink-0 rounded-md bg-muted/60 px-1.5 py-1 text-[10px] font-semibold text-foreground outline-none"
          >
            {cortes.map((c) => (
              <option key={c} value={c}>
                {ROTULO_DO_CORTE[c]}
              </option>
            ))}
          </select>
        )}

        {graficos.length > 1 &&
          graficos.map((kind) => (
            <button
              key={kind}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChart(win.id, kind)}
              aria-pressed={win.chart === kind}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors",
                win.chart === kind
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {CHART_KIND_META[kind].label}
            </button>
          ))}
      </div>
      )}

      {/* Alças de redimensionamento — só em Edição. */}
      {editavel && (
        <>
          <div onPointerDown={startResize("e")} className="absolute inset-y-3 right-0 w-1.5 cursor-ew-resize" aria-hidden />
          <div onPointerDown={startResize("s")} className="absolute inset-x-3 bottom-0 h-1.5 cursor-ns-resize" aria-hidden />
          <div onPointerDown={startResize("se")} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" aria-hidden>
            <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/35">
              <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

export const MetricWindow = memo(MetricWindowBase);
