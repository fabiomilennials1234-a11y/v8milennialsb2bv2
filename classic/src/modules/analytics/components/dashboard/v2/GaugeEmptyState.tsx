import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Gauge, ArrowRight } from "lucide-react";

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

/**
 * Estado vazio do velocímetro — gauge fantasma apagado de fundo (agulha em zero)
 * com convite pra configurar a meta de faturamento. Mesma pegada do cluster,
 * só que "desligado".
 */
function GaugeEmptyStateBase() {
  const ticks = useMemo(() => {
    const t: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
    for (let p = 0; p <= MAX_PCT; p += 5) {
      const major = p % 10 === 0;
      const [x1, y1] = polar(toAngleRad(p), R - (major ? 17 : 11));
      const [x2, y2] = polar(toAngleRad(p), R - 6);
      t.push({ x1, y1, x2, y2, major });
    }
    return t;
  }, []);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* Gauge fantasma — instrumento desligado */}
      <svg
        width={310} height={300} viewBox="0 0 360 348"
        aria-hidden="true"
        className="opacity-[.28]"
      >
        <path d={arcPath(0, MAX_PCT, R)} fill="none" stroke="hsl(var(--foreground) / .12)" strokeWidth={11} strokeLinecap="round" />
        {ticks.map((tk, i) => (
          <line
            key={i}
            x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2}
            stroke={tk.major ? "hsl(var(--foreground) / .25)" : "hsl(var(--foreground) / .1)"}
            strokeWidth={tk.major ? 2 : 1}
          />
        ))}
        {/* Agulha dormindo no zero */}
        <g transform={`rotate(${START} ${CX} ${CY})`}>
          <line
            x1={CX - 22} y1={CY} x2={CX + R - 30} y2={CY}
            stroke="hsl(var(--muted-foreground) / .5)" strokeWidth={3} strokeLinecap="round"
          />
          <circle cx={CX - 22} cy={CY} r={3.5} fill="hsl(var(--muted-foreground) / .5)" />
        </g>
        <circle cx={CX} cy={CY} r={14} fill="hsl(var(--card))" stroke="hsl(var(--foreground) / .12)" strokeWidth={2} />
        <circle cx={CX} cy={CY} r={5} fill="hsl(var(--muted-foreground) / .4)" />
      </svg>

      {/* Convite */}
      <div className="cmd-rise absolute inset-0 flex flex-col items-center justify-center text-center" style={{ animationDelay: ".25s" }}>
        <span className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 shadow-[0_0_24px_hsl(var(--primary)/.15)]">
          <Gauge className="h-5 w-5 text-primary" />
        </span>
        <h3 className="text-[15px] font-extrabold tracking-[-0.02em]">Velocímetro desligado</h3>
        <p className="mt-1.5 max-w-[230px] text-[12px] leading-relaxed text-muted-foreground">
          Defina a meta de faturamento do mês pra acompanhar o ritmo da equipe em tempo real.
        </p>
        <Link
          to="/gestao-metas"
          className="mt-4 inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-bold text-primary-foreground shadow-[inset_0_1px_0_hsl(47_100%_65%/.45),0_6px_18px_hsl(var(--primary)/.18)] transition-transform duration-150 hover:-translate-y-px"
        >
          Configurar meta
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </Link>
      </div>
    </div>
  );
}

export const GaugeEmptyState = memo(GaugeEmptyStateBase);
