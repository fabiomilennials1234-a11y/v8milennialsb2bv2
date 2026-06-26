import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type {
  EconomicsTimeline,
  PhaseKey,
  TimelinePoint,
} from "../../lib/economics-timeline";
import { phaseKeyAtMes } from "../../lib/economics-timeline";
import {
  buildJourneyGeometry,
  type JourneyGeometry,
} from "./lib/journey-geometry";
import {
  formatBRL,
  formatMes,
  formatSignedBRL,
  formatSignedPercent,
} from "./lib/format";
import type { InsightsMode } from "./InsightsModeTabs";

const EASE_DRAW: [number, number, number, number] = [0.4, 0, 0.2, 1];
const DRAW_MS = 1500;

type LineKey = "caixa" | "investimento" | "roi";

const PHASE_LABEL: Record<PhaseKey, string> = {
  prejuizo: "Prejuízo",
  breakeven: "Break-even",
  margem: "Ganho de margem",
  alavancagem: "Alavancagem · ciclos",
};

const PHASE_CHIP_CLASS: Record<PhaseKey, string> = {
  prejuizo: "text-destructive/70",
  breakeven: "text-muted-foreground",
  margem: "text-success/80",
  alavancagem: "text-success/80",
};

/** Tom do gradiente-topo de cada banda (§4) — só o "céu" é tingido. */
const BAND_STOP: Record<PhaseKey, string> = {
  prejuizo: "hsl(var(--destructive) / 0.07)",
  breakeven: "hsl(var(--foreground) / 0.045)",
  margem: "hsl(var(--success) / 0.07)",
  alavancagem: "hsl(var(--success) / 0.1)",
};

/** Mede o container via ResizeObserver. */
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

// ── Legenda compacta + hover-emphasis ────────────────────────────────────────

interface LegendProps {
  highlight: LineKey | null;
  setHighlight: (k: LineKey | null) => void;
}

function JourneyLegend({ highlight, setHighlight }: LegendProps) {
  const items: { key: LineKey; label: string; swatch: JSX.Element; strong?: boolean }[] = [
    {
      key: "caixa",
      label: "Caixa acumulado",
      strong: true,
      swatch: (
        <span className="inline-block h-2.5 w-3.5 rounded-[2px] bg-gradient-to-b from-insights to-insights/20" />
      ),
    },
    {
      key: "investimento",
      label: "Investimento",
      swatch: <span className="inline-block h-0.5 w-4 rounded-full bg-warning" />,
    },
    {
      key: "roi",
      label: "ROI",
      swatch: (
        <span className="inline-flex h-0 w-4 items-center border-t-2 border-dashed border-success" />
      ),
    },
  ];
  return (
    <div
      role="list"
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12px]"
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="listitem"
          aria-label={it.label}
          onMouseEnter={() => setHighlight(it.key)}
          onMouseLeave={() => setHighlight(null)}
          onFocus={() => setHighlight(it.key)}
          onBlur={() => setHighlight(null)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-0.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            highlight && highlight !== it.key && "opacity-40",
          )}
        >
          {it.swatch}
          <span className={it.strong ? "text-foreground" : "text-muted-foreground"}>
            {it.label}
          </span>
        </button>
      ))}
      <span className="text-muted-foreground/40">·</span>
      <span className="flex items-center gap-1.5 text-muted-foreground" role="listitem">
        <span className="inline-block h-3 w-0.5 rounded-full bg-insights" />
        Você está aqui
      </span>
    </div>
  );
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipData {
  mes: number;
  x: number;
  caixa: number;
  investimento: number;
  roi: number;
  isMarker: boolean;
}

function JourneyTooltip({ data, plotWidth }: { data: TooltipData; plotWidth: number }) {
  const phase = phaseKeyAtMes(data.mes);
  const flip = data.x > plotWidth * 0.62;
  return (
    <div
      className="pointer-events-none absolute z-10 w-[200px] -translate-y-full rounded-xl border border-border bg-popover/95 px-3 py-2.5 shadow-lg backdrop-blur"
      style={{
        left: data.x,
        top: 8,
        transform: `translate(${flip ? "-100%" : "0"}, 0)`,
      }}
      role="status"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {formatMes(data.mes)}
        </span>
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.06em]",
            PHASE_CHIP_CLASS[phase],
          )}
        >
          {PHASE_LABEL[phase]}
        </span>
      </div>
      {data.isMarker && (
        <span className="mt-1 inline-block rounded-full bg-insights/15 px-1.5 py-0.5 text-[10px] font-semibold text-insights">
          Você está aqui
        </span>
      )}
      <dl className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-[2px] bg-insights" />
            Caixa acumulado
          </dt>
          <dd
            className={cn(
              "text-[12px] font-semibold tabular-nums",
              data.caixa >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {formatSignedBRL(data.caixa)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-0.5 w-2.5 rounded-full bg-warning" />
            Investimento em tráfego
          </dt>
          <dd className="text-[12px] font-semibold tabular-nums text-foreground">
            {formatBRL(data.investimento)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex h-0 w-2.5 border-t-2 border-dashed border-success" />
            ROI
          </dt>
          <dd
            className={cn(
              "text-[12px] font-semibold tabular-nums",
              data.roi >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {formatSignedPercent(data.roi)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ── Chart principal ──────────────────────────────────────────────────────────

interface JourneyChartProps {
  timeline: EconomicsTimeline;
  /** Caixa real (aba Projeção) — ghost por trás do caixa-meta. */
  ghostCaixa?: TimelinePoint[] | null;
  mode: InsightsMode;
}

/**
 * ⭐ Linha do tempo de unit economics (DESIGN JOURNEY-CHART-REDESIGN). SVG
 * bespoke + framer-motion: 3 linhas (caixa protagonista c/ fill, investimento
 * âmbar, ROI tracejada split no zero), dual-axis com ZERO COMPARTILHADO, 4 faixas
 * de fase tingindo só o céu e um marcador "Você está aqui" que desliza até o mês
 * derivado do CAC. Entrada coreografada via clip-reveal (preserva os dashes do
 * ROI). `prefers-reduced-motion` → estado final imediato.
 */
export function UnitEconomicsJourneyChart({ timeline, ghostCaixa, mode }: JourneyChartProps) {
  const [plotRef, { width, height }] = useElementSize<HTMLDivElement>();
  const reduce = useReducedMotion() ?? false;
  const inViewRef = useRef<HTMLDivElement>(null);
  const inView = useInView(inViewRef, { once: true, amount: 0.3 });
  const uid = useId().replace(/:/g, "");
  const [highlight, setHighlight] = useState<LineKey | null>(null);
  const [hoverMes, setHoverMes] = useState<number | null>(null);

  const faded = timeline.markerMes === null;
  const showGhost = mode === "projecao" && !!ghostCaixa;

  const geo = useMemo<JourneyGeometry | null>(() => {
    if (width < 60 || height < 60) return null;
    return buildJourneyGeometry({
      timeline,
      width,
      height,
      ghostCaixa: showGhost ? ghostCaixa : null,
    });
  }, [width, height, timeline, ghostCaixa, showGhost]);

  const plotW = geo ? geo.plotRight - geo.plotLeft : 1;
  const plotH = geo ? geo.plotBottom - geo.plotTop : 1;

  const lineOpacity = (k: LineKey, base: number) => {
    if (!highlight) return base;
    return highlight === k ? 1 : 0.25;
  };

  const reveal = (delay: number) =>
    reduce
      ? { duration: 0 }
      : { duration: DRAW_MS / 1000, ease: EASE_DRAW, delay };

  const hoverData = useMemo<TooltipData | null>(() => {
    if (!geo || hoverMes === null) return null;
    const idx = timeline.months.indexOf(hoverMes);
    if (idx < 0) return null;
    return {
      mes: hoverMes,
      x: geo.sxMes(hoverMes),
      caixa: timeline.caixa[idx].valor,
      investimento: timeline.investimento[idx].valor,
      roi: timeline.roi[idx].valor,
      isMarker:
        timeline.markerMes !== null && Math.round(timeline.markerMes) === hoverMes,
    };
  }, [geo, hoverMes, timeline]);

  const markerN = timeline.markerMes !== null ? Math.round(timeline.markerMes) : null;
  const ariaLabel =
    `Linha do tempo de unit economics em ${timeline.months.length} meses. ` +
    (timeline.markerMes !== null && timeline.markerPhaseKey
      ? `Você está no ${formatMes(timeline.markerMes)}, fase ${PHASE_LABEL[timeline.markerPhaseKey]}.`
      : "Sem marcador — forma típica da jornada (sem vendas registradas).");

  return (
    <div
      ref={inViewRef}
      className="rounded-2xl border border-border bg-card p-6 md:p-8"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Linha do tempo
          </p>
          <p className="mt-0.5 font-display text-[17px] tracking-[-0.02em] text-foreground md:text-lg">
            Jornada de unit economics
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Investimento, ROI e caixa ao longo do tempo — e o momento desta organização.
          </p>
        </div>
        <JourneyLegend highlight={highlight} setHighlight={setHighlight} />
      </div>

      {/* Plot */}
      <div
        ref={plotRef}
        className="relative mt-5 h-[340px] w-full md:h-[420px] lg:h-[480px]"
      >
        {geo && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            className="overflow-visible"
          >
            <defs>
              {/* Fill do caixa (ancorado no baseline zero) */}
              <linearGradient id={`${uid}-caixa-fill`} x1={0} y1={geo.plotTop} x2={0} y2={geo.zeroY} gradientUnits="userSpaceOnUse">
                <stop offset={0} stopColor="hsl(var(--insights))" stopOpacity={0.16} />
                <stop offset={1} stopColor="hsl(var(--insights))" stopOpacity={0} />
              </linearGradient>
              {/* Split do ROI no zero compartilhado */}
              <linearGradient id={`${uid}-roi`} x1={0} y1={geo.plotTop} x2={0} y2={geo.plotBottom} gradientUnits="userSpaceOnUse">
                {(() => {
                  const off = Math.min(
                    Math.max((geo.zeroY - geo.plotTop) / (geo.plotBottom - geo.plotTop), 0),
                    1,
                  );
                  return (
                    <>
                      <stop offset={0} stopColor="hsl(var(--success))" />
                      <stop offset={off} stopColor="hsl(var(--success))" />
                      <stop offset={off} stopColor="hsl(var(--destructive))" />
                      <stop offset={1} stopColor="hsl(var(--destructive))" />
                    </>
                  );
                })()}
              </linearGradient>
              {/* Gradientes-topo das bandas */}
              {(Object.keys(BAND_STOP) as PhaseKey[]).map((k) => (
                <linearGradient key={k} id={`${uid}-band-${k}`} x1={0} y1={0} x2={0} y2={1}>
                  <stop offset={0} stopColor={BAND_STOP[k]} />
                  <stop offset={0.45} stopColor="hsl(var(--background) / 0)" />
                </linearGradient>
              ))}
              {/* Clip-reveal por linha (preserva o dash do ROI) */}
              {(["caixa", "investimento", "roi"] as LineKey[]).map((k, i) => (
                <clipPath key={k} id={`${uid}-reveal-${k}`}>
                  <motion.rect
                    x={geo.plotLeft}
                    y={geo.plotTop}
                    height={plotH}
                    initial={reduce ? false : { width: 0 }}
                    animate={inView ? { width: plotW } : { width: 0 }}
                    transition={reveal(0.52 + i * 0.15)}
                  />
                </clipPath>
              ))}
            </defs>

            {/* Bandas de fase (tint só no céu) */}
            <g aria-hidden="true">
              {geo.bands.map((b, i) => (
                <motion.g
                  key={b.key}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={inView ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.07 }}
                >
                  <rect
                    x={b.x0}
                    y={geo.plotTop}
                    width={Math.max(b.x1 - b.x0, 0)}
                    height={plotH}
                    fill={`url(#${uid}-band-${b.key})`}
                  />
                  {i > 0 && (
                    <line
                      x1={b.x0}
                      y1={geo.plotTop}
                      x2={b.x0}
                      y2={geo.plotBottom}
                      stroke="hsl(var(--border) / 0.3)"
                      strokeWidth={1}
                    />
                  )}
                  <text
                    x={b.x0 + 8}
                    y={geo.plotTop + 13}
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-[0.08em]",
                      PHASE_CHIP_CLASS[b.key],
                    )}
                    fill="currentColor"
                  >
                    {b.nome}
                  </text>
                </motion.g>
              ))}
            </g>

            {/* Régua de equilíbrio (zero compartilhado) — wipe L→R */}
            <motion.line
              x1={geo.plotLeft}
              y1={geo.zeroY}
              x2={geo.plotRight}
              y2={geo.zeroY}
              stroke="hsl(var(--border))"
              strokeWidth={1}
              strokeDasharray="4 4"
              initial={reduce ? false : { pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : { pathLength: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.22, delay: 0.3, ease: "easeOut" }}
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
            <text
              x={geo.plotRight + 8}
              y={geo.zeroY}
              textAnchor="start"
              dominantBaseline="middle"
              className="text-[10px] tabular-nums"
              fill="hsl(var(--muted-foreground))"
            >
              ROI 0
            </text>

            {/* Ticks R$ (esq.) */}
            {geo.reaisTicks.map((t) => (
              <text
                key={`r${t.valor}`}
                x={geo.plotLeft - 8}
                y={t.y}
                textAnchor="end"
                dominantBaseline="middle"
                className="text-[10px] tabular-nums"
                fill="hsl(var(--muted-foreground) / 0.7)"
              >
                {formatBRL(t.valor)}
              </text>
            ))}
            {/* Ticks ROI (dir.) */}
            {geo.roiTicks.map((t) => (
              <text
                key={`o${t.valor}`}
                x={geo.plotRight + 8}
                y={t.y}
                textAnchor="start"
                dominantBaseline="middle"
                className="text-[10px] tabular-nums"
                fill="hsl(var(--muted-foreground) / 0.7)"
              >
                {formatSignedPercent(t.valor)}
              </text>
            ))}
            {/* Ticks de mês (X) */}
            {geo.monthTicks.map((t) => (
              <text
                key={`m${t.mes}`}
                x={t.x}
                y={geo.plotBottom + 16}
                textAnchor="middle"
                className="text-[10px] tabular-nums"
                fill="hsl(var(--muted-foreground) / 0.7)"
              >
                {t.mes}
              </text>
            ))}

            {/* Ghost (caixa real por trás, na aba Projeção) */}
            {showGhost && geo.ghostCaixaPath && (
              <path
                d={geo.ghostCaixaPath}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={2}
                opacity={0.18}
                aria-hidden="true"
              />
            )}

            {/* Fill do caixa (clip-reveal) */}
            <g clipPath={`url(#${uid}-reveal-caixa)`}>
              <path
                d={geo.caixaAreaPath}
                fill={`url(#${uid}-caixa-fill)`}
                opacity={faded ? 0.5 : 1}
              />
            </g>

            {/* Investimento (âmbar, sólida) */}
            <g clipPath={`url(#${uid}-reveal-investimento)`}>
              <path
                d={geo.investLinePath}
                fill="none"
                stroke="hsl(var(--warning))"
                strokeWidth={highlight === "investimento" ? 2.5 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={lineOpacity("investimento", faded ? 0.45 : 0.9)}
              />
            </g>

            {/* ROI (tracejada, split no zero) */}
            <g clipPath={`url(#${uid}-reveal-roi)`}>
              <path
                d={geo.roiLinePath}
                fill="none"
                stroke={`url(#${uid}-roi)`}
                strokeWidth={highlight === "roi" ? 2.5 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="5 4"
                opacity={lineOpacity("roi", faded ? 0.5 : 1)}
              />
            </g>

            {/* Caixa (protagonista, por cima) */}
            <g clipPath={`url(#${uid}-reveal-caixa)`}>
              <path
                d={geo.caixaLinePath}
                fill="none"
                stroke="hsl(var(--insights))"
                strokeWidth={highlight === "caixa" ? 3.25 : 2.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={lineOpacity("caixa", faded ? 0.5 : 1)}
              />
            </g>

            {/* Marcador "Você está aqui" */}
            {geo.marker && (
              <JourneyMarker geo={geo} reduce={reduce} inView={inView} />
            )}

            {/* Crosshair de hover */}
            {hoverData && (
              <>
                <line
                  x1={hoverData.x}
                  y1={geo.plotTop}
                  x2={hoverData.x}
                  y2={geo.plotBottom}
                  stroke="hsl(var(--insights) / 0.4)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                {[
                  { y: geo.syReais(hoverData.caixa), c: "hsl(var(--insights))" },
                  { y: geo.syReais(hoverData.investimento), c: "hsl(var(--warning))" },
                  {
                    y: geo.syRoi(hoverData.roi),
                    c: hoverData.roi >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))",
                  },
                ].map((d, i) => (
                  <circle key={i} cx={hoverData.x} cy={d.y} r={4} fill="hsl(var(--card))" stroke={d.c} strokeWidth={2} />
                ))}
              </>
            )}

            {/* Hit area */}
            <rect
              x={geo.plotLeft}
              y={geo.plotTop}
              width={plotW}
              height={plotH}
              fill="transparent"
              onMouseMove={(e) => {
                const rect = (e.target as SVGRectElement).getBoundingClientRect();
                const frac = (e.clientX - rect.left) / Math.max(rect.width, 1);
                const mesIdx = Math.round(frac * (timeline.months.length - 1));
                const clamped = Math.min(Math.max(mesIdx, 0), timeline.months.length - 1);
                setHoverMes(timeline.months[clamped]);
              }}
              onMouseLeave={() => setHoverMes(null)}
            />
          </svg>
        )}

        {hoverData && geo && <JourneyTooltip data={hoverData} plotWidth={width} />}

        {/* Caption "sem marcador" */}
        {faded && geo && (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[12px] text-muted-foreground">
            Sem vendas registradas — esta é a forma típica da jornada. O marcador aparece com a primeira venda.
          </p>
        )}
      </div>

      {/* Footer de fases */}
      <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-lg">
        {timeline.phases.map((p) => (
          <div key={p.key} className="border-l border-border/40 px-3 py-2 first:border-l-0">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-[0.08em]",
                PHASE_CHIP_CLASS[p.key],
              )}
            >
              {p.nome}
            </span>
          </div>
        ))}
      </div>

      {/* Tabela sr-only (a11y §13) */}
      <table className="sr-only">
        <caption>Linha do tempo de unit economics</caption>
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col">Caixa acumulado</th>
            <th scope="col">Investimento</th>
            <th scope="col">ROI</th>
          </tr>
        </thead>
        <tbody>
          {timeline.months.map((m, i) => (
            <tr key={m}>
              <th scope="row">
                {formatMes(m)}
                {markerN === m ? " (você está aqui)" : ""}
              </th>
              <td>{formatSignedBRL(timeline.caixa[i].valor)}</td>
              <td>{formatBRL(timeline.investimento[i].valor)}</td>
              <td>{formatSignedPercent(timeline.roi[i].valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Marcador ─────────────────────────────────────────────────────────────────

interface MarkerProps {
  geo: JourneyGeometry;
  reduce: boolean;
  inView: boolean;
}

function JourneyMarker({ geo, reduce, inView }: MarkerProps) {
  const m = geo.marker!;
  const slideFrom = geo.plotLeft - m.x;
  const n = Math.round(m.mes);
  const chipLabel = `${PHASE_LABEL[m.phaseKey]} · mês ${n}`;
  // Clampa o chip dentro do plot p/ não estourar a borda.
  const chipW = 150;
  const chipX = Math.min(Math.max(m.x, geo.plotLeft + chipW / 2), geo.plotRight - chipW / 2);

  return (
    <motion.g
      initial={reduce ? false : { x: slideFrom, opacity: 0 }}
      animate={inView ? { x: 0, opacity: 1 } : { x: slideFrom, opacity: 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 90, damping: 16, delay: 1.6, opacity: { duration: 0.3, delay: 1.6 } }
      }
    >
      {/* Linha vertical */}
      <line
        x1={m.x}
        y1={geo.plotTop}
        x2={m.x}
        y2={geo.plotBottom}
        stroke="hsl(var(--insights))"
        strokeWidth={2}
        style={{ filter: "drop-shadow(0 0 6px hsl(var(--insights) / 0.45))" }}
      />

      {/* Ticks secundários (ROI + investimento) */}
      <circle cx={m.x} cy={m.investY} r={3} fill="hsl(var(--warning))" opacity={0.85} />
      <circle
        cx={m.x}
        cy={m.roiY}
        r={3}
        fill={m.roiValor >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"}
        opacity={0.85}
      />

      {/* Halo pulsante no caixa */}
      {!reduce && (
        <motion.circle
          cx={m.x}
          cy={m.caixaY}
          fill="none"
          stroke="hsl(var(--insights))"
          strokeWidth={1.5}
          initial={{ r: 7, opacity: 0.45 }}
          animate={{ r: [7, 16], opacity: [0.45, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 2.0 }}
        />
      )}
      {/* Dot protagonista no caixa */}
      <circle cx={m.x} cy={m.caixaY} r={6.5} fill="hsl(var(--card))" />
      <circle
        cx={m.x}
        cy={m.caixaY}
        r={6.5}
        fill="none"
        stroke="hsl(var(--insights))"
        strokeWidth={2.5}
      />

      {/* Pino/flâmula */}
      <g transform={`translate(${chipX}, ${geo.plotTop - 4})`}>
        <path d="M0,4 L-5,-2 L5,-2 Z" fill="hsl(var(--insights))" />
        <rect
          x={-chipW / 2}
          y={-30}
          width={chipW}
          height={28}
          rx={8}
          fill="hsl(var(--insights))"
        />
        <text
          x={0}
          y={-19}
          textAnchor="middle"
          className="text-[11px] font-semibold"
          fill="hsl(var(--insights-foreground))"
        >
          Você está aqui
        </text>
        <text
          x={0}
          y={-7}
          textAnchor="middle"
          className="text-[9px] font-medium"
          fill="hsl(var(--insights-foreground) / 0.85)"
        >
          {chipLabel}
        </text>
      </g>
    </motion.g>
  );
}
