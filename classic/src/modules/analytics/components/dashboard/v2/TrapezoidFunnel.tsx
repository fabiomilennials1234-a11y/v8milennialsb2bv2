import { memo, useMemo } from "react";
import { Link } from "react-router-dom";

interface FunnelStageInput {
  label: string;
  value: number;
}

interface TrapezoidFunnelProps {
  /** Exatamente 4 estágios: Leads, Reuniões, Propostas, Vendas. */
  stages: [FunnelStageInput, FunnelStageInput, FunnelStageInput, FunnelStageInput];
  /** Delta da conversão total vs período anterior, em pontos percentuais. */
  deltaPp: number | null;
  prevLabel: string;
}

const LEVEL_STYLE = [
  { inset: "0%", insetB: "7%", bg: "linear-gradient(180deg,hsl(47 100% 50%),hsl(47 100% 43%))", color: "hsl(30 18% 12%)" },
  { inset: "7%", insetB: "14%", bg: "linear-gradient(180deg,hsl(46 85% 38%),hsl(46 85% 32%))", color: "hsl(45 30% 96%)" },
  { inset: "14%", insetB: "21%", bg: "linear-gradient(180deg,hsl(44 50% 25%),hsl(44 50% 20%))", color: "hsl(45 25% 92%)" },
  { inset: "21%", insetB: "26%", bg: "linear-gradient(180deg,hsl(142 70% 42%),hsl(142 70% 34%))", color: "hsl(0 0% 100%)" },
] as const;

const RATE_LABELS = ["viram reunião", "recebem proposta", "fecham"] as const;

/**
 * Funil trapezoidal da Central de Comando — níveis afunilando com taxas de
 * conversão entre etapas e leitura de gargalo no rodapé (mockup v3 aprovado).
 */
function TrapezoidFunnelBase({ stages, deltaPp, prevLabel }: TrapezoidFunnelProps) {
  const { rates, shares, convTotal, bottleneckIdx } = useMemo(() => {
    const total = stages[0].value;
    const shares = stages.map((s) => (total > 0 ? (s.value / total) * 100 : 0));
    const rates = stages.slice(1).map((s, i) =>
      stages[i].value > 0 ? (s.value / stages[i].value) * 100 : 0,
    );
    const convTotal = total > 0 ? (stages[3].value / total) * 100 : 0;
    let bottleneckIdx = 0;
    rates.forEach((r, i) => { if (r < rates[bottleneckIdx]) bottleneckIdx = i; });
    return { rates, shares, convTotal, bottleneckIdx };
  }, [stages]);

  const hasData = stages[0].value > 0;

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".5s" }}>
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">Funil de vendas</span>
        <span className="rounded-full bg-primary/15 px-[9px] py-[3px] text-[10.5px] font-extrabold tracking-[.02em] text-primary tabular-nums">
          conv. total {convTotal.toFixed(1).replace(".", ",")}%
        </span>
      </div>

      <div className="mt-4 flex flex-col items-center">
        {stages.map((stage, i) => {
          const st = LEVEL_STYLE[i];
          return (
            <div key={stage.label} className="contents">
              {i > 0 && (
                <div
                  className="cmd-fadein flex h-[26px] items-center gap-2"
                  style={{ animationDelay: `${1 + (i - 1) * 0.25}s` }}
                >
                  <span className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-muted-foreground/40" />
                  <span className="rounded-full bg-primary/15 px-2 py-[2px] text-[10.5px] font-extrabold text-primary tabular-nums">
                    {Math.round(rates[i - 1])}%
                  </span>
                  <span className="text-[10.5px] font-semibold text-muted-foreground/70">{RATE_LABELS[i - 1]}</span>
                </div>
              )}
              <div
                className="cmd-growy relative flex h-[50px] w-full cursor-pointer items-center justify-center transition-[filter] duration-150 hover:brightness-[1.18]"
                style={{
                  clipPath: `polygon(${st.inset} 0, calc(100% - ${st.inset}) 0, calc(100% - ${st.insetB}) 100%, ${st.insetB} 100%)`,
                  background: st.bg,
                  color: st.color,
                  animationDelay: `${0.6 + i * 0.25}s`,
                }}
              >
                <span className="text-[17px] font-extrabold tracking-[-0.02em] tabular-nums">{stage.value}</span>
                <span className="ml-2 text-[10.5px] font-bold uppercase tracking-[.06em] opacity-75">{stage.label}</span>
                <span className="absolute right-3.5 text-[10.5px] font-bold opacity-60 tabular-nums">
                  {Math.round(shares[i])}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="cmd-fadein mt-3.5 flex items-center justify-between border-t border-border/70 pt-3"
        style={{ animationDelay: "1.7s" }}
      >
        <span className="text-[11px] font-semibold text-muted-foreground/70">
          {hasData ? (
            <>Gargalo: <b className="font-extrabold text-destructive">{stages[bottleneckIdx].label} → {stages[bottleneckIdx + 1].label}</b></>
          ) : (
            "Sem dados no período"
          )}
        </span>
        {deltaPp !== null && (
          <b className={`text-[11px] font-extrabold ${deltaPp >= 0 ? "text-success" : "text-destructive"}`}>
            {deltaPp >= 0 ? "+" : ""}{deltaPp.toFixed(1).replace(".", ",")}pp {prevLabel}
          </b>
        )}
        <Link to="/funis" className="text-[11px] font-bold text-muted-foreground transition-colors hover:text-primary">
          Ver funis →
        </Link>
      </div>
    </div>
  );
}

export const TrapezoidFunnel = memo(TrapezoidFunnelBase);
