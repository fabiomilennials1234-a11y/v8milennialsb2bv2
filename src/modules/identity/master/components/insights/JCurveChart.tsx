import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { PaybackCurveResult } from "../../lib/unit-economics";
import {
  buildJCurveGeometry,
  type JCurveGeometry,
} from "./lib/jcurve-geometry";
import { formatMes, formatSignedBRL } from "./lib/format";
import type { InsightsMode } from "./InsightsModeTabs";

const EASE_DRAW: [number, number, number, number] = [0.4, 0, 0.2, 1];
const EASE_OVERSHOOT: [number, number, number, number] = [0.175, 0.885, 0.32, 1.275];
const DRAW_MS = 1600;

/** Mede o container (largura/altura) via ResizeObserver. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

export function JCurveGhostOverlay({ d }: { d: string | null }) {
  if (!d) return null;
  return (
    <path
      d={d}
      fill="none"
      stroke="hsl(var(--border))"
      strokeWidth={2}
      strokeLinecap="round"
      opacity={0.18}
      aria-hidden="true"
    />
  );
}

interface MarkerProps {
  geo: JCurveGeometry;
  reduce: boolean;
  inView: boolean;
}

export function JCurveMarker({ geo, reduce, inView }: MarkerProps) {
  const { bottomMark, breakEvenMark, zeroY, plotLeft } = geo;
  const plotW = geo.plotRight - geo.plotLeft;

  const delayFor = (x: number) =>
    reduce ? 0 : ((x - plotLeft) / Math.max(plotW, 1)) * (DRAW_MS / 1000);

  return (
    <g>
      {bottomMark && (
        <>
          <line
            x1={bottomMark.x}
            y1={bottomMark.y}
            x2={bottomMark.x}
            y2={zeroY}
            stroke="hsl(var(--destructive))"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <motion.g
            initial={reduce ? false : { scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : {}}
            transition={{ duration: 0.4, delay: delayFor(bottomMark.x), ease: EASE_OVERSHOOT }}
            style={{ transformOrigin: `${bottomMark.x}px ${bottomMark.y}px` }}
          >
            <circle cx={bottomMark.x} cy={bottomMark.y} r={4} fill="hsl(var(--destructive))" />
            <text
              x={bottomMark.x}
              y={bottomMark.y + 18}
              textAnchor="middle"
              className="fill-destructive text-[11px] font-semibold tabular-nums"
              fill="hsl(var(--destructive))"
            >
              {formatSignedBRL(bottomMark.valor)}
            </text>
          </motion.g>
        </>
      )}

      {breakEvenMark && (
        <motion.g
          initial={reduce ? false : { scale: 0, opacity: 0 }}
          animate={inView ? { scale: 1, opacity: 1 } : {}}
          transition={{ duration: 0.4, delay: delayFor(breakEvenMark.x), ease: EASE_OVERSHOOT }}
          style={{ transformOrigin: `${breakEvenMark.x}px ${zeroY}px` }}
        >
          <circle cx={breakEvenMark.x} cy={zeroY} r={6} fill="hsl(var(--card))" />
          <circle
            cx={breakEvenMark.x}
            cy={zeroY}
            r={6}
            fill="none"
            stroke="hsl(var(--insights))"
            strokeWidth={2.5}
          />
          <text
            x={breakEvenMark.x}
            y={zeroY - 14}
            textAnchor="middle"
            className="text-[11px] font-semibold tabular-nums"
            fill="hsl(var(--insights))"
          >
            {formatMes(breakEvenMark.mes)}
          </text>
        </motion.g>
      )}
    </g>
  );
}

const REGIONS = [
  { label: "Investimento", className: "text-destructive/80" },
  { label: "Autofinanciamento", className: "text-muted-foreground" },
  { label: "Payback", className: "text-insights/90" },
  { label: "Lucro", className: "text-success/90" },
];

export function JCurveRegionLabels({ reduce }: { reduce: boolean }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg sm:grid-cols-4">
      {REGIONS.map((r, i) => (
        <motion.div
          key={r.label}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: reduce ? 0 : DRAW_MS / 1000 + i * 0.06 }}
          className="border-l border-border/40 px-3 py-2 first:border-l-0"
        >
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.08em]",
              r.className,
            )}
          >
            {r.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

interface TooltipProps {
  x: number;
  y: number;
  mes: number;
  valor: number;
}

export function JCurveTooltip({ x, y, mes, valor }: TooltipProps) {
  const positive = valor >= 0;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover/95 px-3 py-2 shadow-md backdrop-blur"
      style={{ left: x, top: y - 12 }}
      role="status"
    >
      <p className="text-[11px] font-medium text-muted-foreground">{formatMes(mes)}</p>
      <p
        className={cn(
          "mt-0.5 text-[13px] font-semibold tabular-nums",
          positive ? "text-success" : "text-destructive",
        )}
      >
        Caixa descontado: {formatSignedBRL(valor)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {positive ? "Lucro acumulado" : "Em investimento"}
      </p>
    </div>
  );
}

// ── Chart principal ──────────────────────────────────────────────────────────

interface JCurveChartProps {
  curve: PaybackCurveResult;
  ghostCurve?: PaybackCurveResult | null;
  mode: InsightsMode;
}

/**
 * ⭐ Curva J de payback (DESIGN §10). SVG bespoke + framer-motion (não recharts).
 * Pontos vêm de `computePaybackCurve`; a UI só desenha o path suave, áreas,
 * marcadores, regiões e tooltip — com draw-on cinematográfico.
 */
export function JCurveChart({ curve, ghostCurve, mode }: JCurveChartProps) {
  const [plotRef, { width, height }] = useElementSize<HTMLDivElement>();
  const reduce = useReducedMotion() ?? false;
  const inViewRef = useRef<HTMLDivElement>(null);
  const inView = useInView(inViewRef, { once: true, amount: 0.3 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const ghostPoints = mode === "projecao" && ghostCurve?.defined ? ghostCurve.points : null;

  const geo = useMemo<JCurveGeometry | null>(() => {
    if (width < 40 || height < 40 || !curve.defined) return null;
    return buildJCurveGeometry({
      points: curve.points,
      marks: curve.marks,
      width,
      height,
      ghostPoints,
    });
  }, [width, height, curve, ghostPoints]);

  const drawTransition = reduce
    ? { duration: 0 }
    : { duration: DRAW_MS / 1000, ease: EASE_DRAW };

  const hoverPoint =
    geo && hoverIdx !== null && curve.points[hoverIdx]
      ? { ...geo.pixelPoints[hoverIdx], ...curve.points[hoverIdx] }
      : null;

  const ariaLabel = curve.defined
    ? `Curva de payback em J. Caixa máximo consumido ${formatSignedBRL(
        curve.marks.maxCashConsumed ?? 0,
      )} no ${formatMes(curve.marks.maxCashMes)}. ${
        curve.marks.breakEvenMes != null
          ? `Ponto de equilíbrio no ${formatMes(curve.marks.breakEvenMes)}.`
          : "Sem ponto de equilíbrio no horizonte."
      }`
    : "Curva de payback indisponível.";

  return (
    <div ref={inViewRef} className="rounded-2xl border border-border bg-card p-6 md:p-8">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Curva J de payback
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Caixa descontado ao longo do tempo
          </p>
        </div>
        {mode === "projecao" && ghostPoints && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-px w-4 border-t-2 border-dashed border-border" />
            Comparar com real
          </span>
        )}
      </div>

      <div
        ref={plotRef}
        className="relative mt-4 h-[320px] w-full md:h-[420px] lg:h-[480px]"
      >
        {!curve.defined ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Defina metas de vendas para projetar a curva.
            </p>
          </div>
        ) : geo ? (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={ariaLabel}
              className="overflow-visible"
            >
              <defs>
                <linearGradient
                  id="jcurve-line"
                  x1={0}
                  y1={geo.plotTop}
                  x2={0}
                  y2={geo.plotBottom}
                  gradientUnits="userSpaceOnUse"
                >
                  {(() => {
                    const off = Math.min(
                      Math.max((geo.zeroY - geo.plotTop) / (geo.plotBottom - geo.plotTop), 0),
                      1,
                    );
                    return (
                      <>
                        <stop offset={0} stopColor="hsl(142 70% 45%)" />
                        <stop offset={off} stopColor="hsl(142 70% 45%)" />
                        <stop offset={off} stopColor="hsl(0 62% 50%)" />
                        <stop offset={1} stopColor="hsl(0 62% 50%)" />
                      </>
                    );
                  })()}
                </linearGradient>
                <linearGradient
                  id="jcurve-area-above"
                  x1={0}
                  y1={geo.plotTop}
                  x2={0}
                  y2={geo.zeroY}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset={0} stopColor="hsl(142 70% 45%)" stopOpacity={0.28} />
                  <stop offset={1} stopColor="hsl(142 70% 45%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient
                  id="jcurve-area-below"
                  x1={0}
                  y1={geo.zeroY}
                  x2={0}
                  y2={geo.plotBottom}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset={0} stopColor="hsl(0 62% 50%)" stopOpacity={0} />
                  <stop offset={1} stopColor="hsl(0 62% 50%)" stopOpacity={0.3} />
                </linearGradient>
                <clipPath id="jcurve-clip-above">
                  <rect
                    x={geo.plotLeft}
                    y={geo.plotTop}
                    width={geo.plotRight - geo.plotLeft}
                    height={Math.max(geo.zeroY - geo.plotTop, 0)}
                  />
                </clipPath>
                <clipPath id="jcurve-clip-below">
                  <rect
                    x={geo.plotLeft}
                    y={geo.zeroY}
                    width={geo.plotRight - geo.plotLeft}
                    height={Math.max(geo.plotBottom - geo.zeroY, 0)}
                  />
                </clipPath>
                <clipPath id="jcurve-clip-reveal">
                  <motion.rect
                    x={geo.plotLeft}
                    y={geo.plotTop}
                    height={geo.plotBottom - geo.plotTop}
                    initial={reduce ? false : { width: 0 }}
                    animate={inView ? { width: geo.plotRight - geo.plotLeft } : { width: 0 }}
                    transition={drawTransition}
                  />
                </clipPath>
              </defs>

              {/* Régua do zero */}
              <line
                x1={geo.plotLeft}
                y1={geo.zeroY}
                x2={geo.plotRight}
                y2={geo.zeroY}
                stroke="hsl(var(--border))"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={geo.plotLeft - 8}
                y={geo.zeroY}
                textAnchor="end"
                dominantBaseline="middle"
                className="text-[10px] tabular-nums"
                fill="hsl(var(--muted-foreground))"
              >
                R$ 0
              </text>

              {/* Áreas (clip por sinal ∩ reveal animado) */}
              <g clipPath="url(#jcurve-clip-reveal)">
                <path
                  d={geo.areaPath}
                  fill="url(#jcurve-area-above)"
                  clipPath="url(#jcurve-clip-above)"
                />
                <path
                  d={geo.areaPath}
                  fill="url(#jcurve-area-below)"
                  clipPath="url(#jcurve-clip-below)"
                />
              </g>

              {/* Ghost (curva real por trás, na aba Projeção) */}
              <JCurveGhostOverlay d={geo.ghostPath} />

              {/* Linha — draw-on */}
              <motion.path
                d={geo.linePath}
                fill="none"
                stroke="url(#jcurve-line)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={inView ? { pathLength: 1 } : { pathLength: 0 }}
                transition={drawTransition}
              />

              {/* Marcadores */}
              <JCurveMarker geo={geo} reduce={reduce} inView={inView} />

              {/* Crosshair de hover */}
              {hoverPoint && (
                <>
                  <line
                    x1={hoverPoint.x}
                    y1={geo.plotTop}
                    x2={hoverPoint.x}
                    y2={geo.plotBottom}
                    stroke="hsl(var(--insights) / 0.5)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={hoverPoint.x}
                    cy={hoverPoint.y}
                    r={5}
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--insights))"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* Eixos (títulos) */}
              <text
                x={geo.plotLeft + (geo.plotRight - geo.plotLeft) / 2}
                y={height - 2}
                textAnchor="middle"
                className="text-[10px] uppercase tracking-[0.1em]"
                fill="hsl(var(--muted-foreground))"
              >
                Tempo
              </text>

              {/* Captura de hover */}
              <rect
                x={geo.plotLeft}
                y={geo.plotTop}
                width={geo.plotRight - geo.plotLeft}
                height={geo.plotBottom - geo.plotTop}
                fill="transparent"
                onMouseMove={(e) => {
                  const rect = (e.target as SVGRectElement).getBoundingClientRect();
                  const rel = e.clientX - rect.left;
                  const frac = rel / Math.max(rect.width, 1);
                  const idx = Math.round(frac * (curve.points.length - 1));
                  setHoverIdx(Math.min(Math.max(idx, 0), curve.points.length - 1));
                }}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </svg>

            {hoverPoint && (
              <JCurveTooltip
                x={hoverPoint.x}
                y={hoverPoint.y}
                mes={hoverPoint.mes}
                valor={hoverPoint.valor}
              />
            )}
          </>
        ) : null}
      </div>

      <JCurveRegionLabels reduce={reduce} />

      {/* Tabela sr-only dos marcos (a11y §17) */}
      <table className="sr-only">
        <caption>Marcos da curva de payback</caption>
        <tbody>
          <tr>
            <th scope="row">Caixa máximo consumido</th>
            <td>{formatSignedBRL(curve.marks.maxCashConsumed ?? 0)}</td>
            <td>{formatMes(curve.marks.maxCashMes)}</td>
          </tr>
          <tr>
            <th scope="row">Ponto de equilíbrio</th>
            <td>{formatMes(curve.marks.breakEvenMes)}</td>
          </tr>
          <tr>
            <th scope="row">Horizonte</th>
            <td>{formatMes(curve.marks.horizonteMeses)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
