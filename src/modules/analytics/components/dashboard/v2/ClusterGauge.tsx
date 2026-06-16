import { memo, useEffect, useMemo, useRef } from "react";

interface ClusterGaugeProps {
  /** Percentual realizado da meta (0–130+, clampa em 130 no mostrador). */
  currentPercent: number;
  /** Percentual esperado pelo pacing do período (marcador triangular). */
  expectedPercent: number;
  /** Linha abaixo da leitura digital — ex.: "esperado 37% · dia 11 de 30". */
  subtitle: string;
  /** Status estilo cluster — ex.: "// NO RITMO +34PP". Verde se ahead, vermelho se atrás. */
  statusText: string;
  isAhead: boolean;
}

const CX = 180;
const CY = 176;
const R = 148;
const START = 135;
const SWEEP = 270;
const MAX_PCT = 130;

const toAngleRad = (pct: number) => ((START + (pct / MAX_PCT) * SWEEP) * Math.PI) / 180;
const polar = (angleRad: number, radius: number): [number, number] => [
  CX + Math.cos(angleRad) * radius,
  CY + Math.sin(angleRad) * radius,
];

function arcPath(p0: number, p1: number, radius: number): string {
  const [x0, y0] = polar(toAngleRad(p0), radius);
  const [x1, y1] = polar(toAngleRad(p1), radius);
  const large = ((p1 - p0) / MAX_PCT) * SWEEP > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
}

function easeOutBack(x: number) {
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Velocímetro da Central de Comando — 270°, redline acima de 100%, agulha com
 * contrapeso, leitura digital. Sweep com overshoot (easeOutBack) + micro-oscilação
 * idle. Respeita prefers-reduced-motion (render estático) e pausa em aba oculta.
 */
function ClusterGaugeBase({ currentPercent, expectedPercent, subtitle, statusText, isAhead }: ClusterGaugeProps) {
  const clamped = Math.min(Math.max(currentPercent, 0), MAX_PCT);
  const clampedExpected = Math.min(Math.max(expectedPercent, 0), MAX_PCT);

  const needleRef = useRef<SVGGElement>(null);
  const progRef = useRef<SVGPathElement>(null);
  const digitRef = useRef<SVGTextElement>(null);
  const expRef = useRef<SVGGElement>(null);
  const statusRef = useRef<SVGTextElement>(null);
  const rafRef = useRef<number>();

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Ticks + labels — geometria estática, computada uma vez
  const { ticks, tickLabels, redlineHatch } = useMemo(() => {
    const t: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
    const l: Array<{ x: number; y: number; text: string }> = [];
    for (let p = 0; p <= MAX_PCT; p += 2.5) {
      const major = p % 10 === 0;
      if (!major && p % 5 !== 0) continue;
      const [x1, y1] = polar(toAngleRad(p), R - (major ? 17 : 11));
      const [x2, y2] = polar(toAngleRad(p), R - 6);
      t.push({ x1, y1, x2, y2, major });
      if (p % 20 === 0) {
        const [lx, ly] = polar(toAngleRad(p), R - 29);
        l.push({ x: lx, y: ly, text: String(p) });
      }
    }
    const h: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let p = 102; p < MAX_PCT; p += 3.5) {
      const [x1, y1] = polar(toAngleRad(p), R - 4);
      const [x2, y2] = polar(toAngleRad(p), R + 4);
      h.push({ x1, y1, x2, y2 });
    }
    return { ticks: t, tickLabels: l, redlineHatch: h };
  }, []);

  const expectedDeg = START + (clampedExpected / MAX_PCT) * SWEEP;
  const finalDeg = START + (Math.max(clamped, 0.01) / MAX_PCT) * SWEEP;

  useEffect(() => {
    const needle = needleRef.current;
    const prog = progRef.current;
    const digit = digitRef.current;
    const exp = expRef.current;
    const status = statusRef.current;
    if (!needle || !prog || !digit || !exp || !status) return;

    if (reducedMotion) {
      needle.setAttribute("transform", `rotate(${finalDeg} ${CX} ${CY})`);
      prog.setAttribute("d", arcPath(0, Math.max(clamped, 0.5), R));
      digit.textContent = String(Math.round(clamped));
      exp.setAttribute("opacity", "1");
      status.setAttribute("opacity", "1");
      return;
    }

    const T0 = performance.now();
    const DUR = 1600;
    const DELAY = 400;
    let settled = false;
    let settleTime = 0;

    const frame = (now: number) => {
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      if (!settled) {
        const t = Math.min(Math.max((now - T0 - DELAY) / DUR, 0), 1);
        const p = Math.max(clamped * easeOutBack(t), 0.01);
        needle.setAttribute("transform", `rotate(${START + (p / MAX_PCT) * SWEEP} ${CX} ${CY})`);
        prog.setAttribute("d", arcPath(0, Math.max(Math.min(p, clamped), 0.5), R));
        digit.textContent = String(Math.round(Math.min(p, clamped)));
        exp.setAttribute("opacity", String(Math.min(t * 1.8, 1)));
        if (t >= 0.85) status.setAttribute("opacity", String(Math.min((t - 0.85) * 6, 1)));
        if (t >= 1) {
          settled = true;
          settleTime = now;
        }
      } else {
        // Micro-oscilação idle — agulha de instrumento real nunca fica parada
        const j = Math.sin((now - settleTime) / 650) * 0.45;
        needle.setAttribute("transform", `rotate(${finalDeg + j} ${CX} ${CY})`);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [clamped, finalDeg, reducedMotion]);

  return (
    <svg width={310} height={300} viewBox="0 0 360 348" role="img" aria-label={`Meta do período: ${Math.round(clamped)}% realizado, ${Math.round(clampedExpected)}% esperado`}>
      {/* Trilho + redline */}
      <path d={arcPath(0, MAX_PCT, R)} fill="none" stroke="hsl(var(--foreground) / .07)" strokeWidth={11} strokeLinecap="round" />
      <path d={arcPath(100, MAX_PCT, R)} fill="none" stroke="hsl(var(--destructive) / .22)" strokeWidth={11} />
      {redlineHatch.map((ln, i) => (
        <line key={`h${i}`} {...ln} stroke="hsl(var(--destructive) / .6)" strokeWidth={2} />
      ))}
      {/* Ticks */}
      {ticks.map((tk, i) => (
        <line
          key={`t${i}`}
          x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2}
          stroke={tk.major ? "hsl(var(--foreground) / .4)" : "hsl(var(--foreground) / .13)"}
          strokeWidth={tk.major ? 2 : 1}
        />
      ))}
      {tickLabels.map((lb, i) => (
        <text
          key={`l${i}`}
          x={lb.x} y={lb.y}
          textAnchor="middle" dominantBaseline="middle"
          className="fill-muted-foreground/70"
          style={{ fontSize: 9.5, fontWeight: 600 }}
        >
          {lb.text}
        </text>
      ))}
      {/* Arco de progresso */}
      <path
        ref={progRef}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={11}
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 7px hsl(var(--primary) / .5))" }}
      />
      {/* Marcador do esperado */}
      <g ref={expRef} opacity={0}>
        <polygon
          points={`${CX + R + 7},${CY - 5} ${CX + R + 16},${CY} ${CX + R + 7},${CY + 5}`}
          fill="hsl(var(--foreground) / .9)"
          transform={`rotate(${expectedDeg} ${CX} ${CY})`}
        />
      </g>
      {/* Agulha com contrapeso */}
      <g ref={needleRef} transform={`rotate(${START} ${CX} ${CY})`}>
        <line
          x1={CX - 22} y1={CY} x2={CX + R - 30} y2={CY}
          stroke="hsl(var(--primary))" strokeWidth={3} strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 5px hsl(var(--primary) / .55))" }}
        />
        <circle cx={CX - 22} cy={CY} r={3.5} fill="hsl(var(--primary))" />
      </g>
      {/* Hub */}
      <circle cx={CX} cy={CY} r={14} fill="hsl(var(--card))" stroke="hsl(var(--foreground) / .15)" strokeWidth={2} />
      <circle cx={CX} cy={CY} r={5} fill="hsl(var(--primary))" />
      {/* Leitura digital */}
      <text
        ref={digitRef}
        x={CX} y={CY + 82}
        textAnchor="middle"
        className="cmd-mono fill-foreground tabular-nums"
        style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.02em" }}
      >
        0
      </text>
      <text x={CX + 58} y={CY + 82} textAnchor="start" className="fill-muted-foreground" style={{ fontSize: 11, fontWeight: 600 }}>
        %
      </text>
      <text x={CX} y={CY + 104} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11, fontWeight: 600 }}>
        {subtitle}
      </text>
      <text
        ref={statusRef}
        x={CX} y={CY + 126}
        textAnchor="middle"
        opacity={0}
        className="cmd-mono"
        style={{
          fontSize: 10, fontWeight: 600, letterSpacing: ".18em",
          fill: isAhead ? "hsl(var(--success))" : "hsl(var(--destructive))",
        }}
      >
        {statusText}
      </text>
    </svg>
  );
}

export const ClusterGauge = memo(ClusterGaugeBase);
