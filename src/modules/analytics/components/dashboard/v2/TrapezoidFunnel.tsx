import { memo, useMemo } from "react";
import { Link } from "react-router-dom";

interface FunnelStageInput {
  label: string;
  value: number;
}

interface TrapezoidFunnelProps {
  /** Exatamente 4 estágios: Leads, Reuniões, Propostas, Vendas. */
  stages: [FunnelStageInput, FunnelStageInput, FunnelStageInput, FunnelStageInput];
  /** Delta da proporção vendas/leads vs período anterior, em pontos percentuais. */
  deltaPp: number | null;
  prevLabel: string;
  scopeLabel?: string;
}

// Rampa de ouro em token (o mesmo matiz perdendo força a cada etapa) e o
// verde de venda no fundo — sem gradiente literal, os dois temas respondem.
const LEVEL_STYLE = [
  { inset: "0%", insetB: "7%", cls: "bg-primary text-primary-foreground" },
  { inset: "7%", insetB: "14%", cls: "bg-primary/70 text-primary-foreground" },
  { inset: "14%", insetB: "21%", cls: "bg-primary/35 text-foreground" },
  { inset: "21%", insetB: "26%", cls: "bg-success text-success-foreground" },
] as const;

const RATE_LABELS = ["reuniões / leads", "propostas / reuniões", "vendas / propostas"] as const;

/**
 * Volumes do período no formato trapezoidal; as razões não medem a conversão
 * de uma mesma coorte, pois cada atividade tem sua própria data.
 */
function TrapezoidFunnelBase({ stages, deltaPp, prevLabel, scopeLabel = "Equipe" }: TrapezoidFunnelProps) {
  const { rates, shares, convTotal, bottleneckIdx } = useMemo(() => {
    const total = stages[0].value;
    const shares = stages.map((s) => (total > 0 ? (s.value / total) * 100 : null));
    const rates = stages.slice(1).map((s, i) =>
      stages[i].value > 0 ? (s.value / stages[i].value) * 100 : null,
    );
    const convTotal = total > 0 ? (stages[3].value / total) * 100 : null;
    let bottleneckIdx = -1;
    rates.forEach((r, i) => {
      if (r !== null && (bottleneckIdx === -1 || r < (rates[bottleneckIdx] ?? Infinity))) bottleneckIdx = i;
    });
    return { rates, shares, convTotal, bottleneckIdx };
  }, [stages]);

  const hasData = stages.some((stage) => stage.value > 0);

  return (
    // Volumes de atividade, não uma coorte de leads convertidos (ADR-0013).
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{scopeLabel} · atividade no período</span>
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-primary-soft-foreground">
          vendas / leads {convTotal === null ? "—" : `${convTotal.toFixed(1).replace(".", ",")}%`}
        </span>
      </div>

      <div className="mb-3.5 mt-3 flex flex-col items-center">
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
                  <span className="rounded-full bg-primary-soft px-2 py-[2px] text-[10.5px] font-bold tabular-nums text-primary-soft-foreground">
                    {rates[i - 1] === null ? "—" : `${Math.round(rates[i - 1] ?? 0)}%`}
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">{RATE_LABELS[i - 1]}</span>
                </div>
              )}
              <div
                className={`cmd-growy relative flex h-[50px] w-full items-center justify-center transition-[filter] duration-150 hover:brightness-110 ${st.cls}`}
                style={{
                  clipPath: `polygon(${st.inset} 0, calc(100% - ${st.inset}) 0, calc(100% - ${st.insetB}) 100%, ${st.insetB} 100%)`,
                  animationDelay: `${0.6 + i * 0.25}s`,
                }}
              >
                <span className="text-[17px] font-extrabold tracking-[-0.03em] tabular-nums">{stage.value}</span>
                <span className="ml-2 text-[10.5px] font-bold uppercase tracking-[.06em] opacity-80">{stage.label}</span>
                {/* A porcentagem acompanha a borda inclinada (meio da altura),
                    senão o recorte do trapézio a engole nos níveis estreitos. */}
                <span
                  className="absolute text-[10.5px] font-bold opacity-70 tabular-nums"
                  style={{ right: `calc(${(parseFloat(st.inset) + parseFloat(st.insetB)) / 2}% + 10px)` }}
                >
                  {shares[i] === null ? "—" : `${Math.round(shares[i] ?? 0)}%`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="cmd-fadein mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-3"
        style={{ animationDelay: "1.7s" }}
      >
        <span className="text-[11px] font-semibold text-muted-foreground">
          {bottleneckIdx >= 0 ? (
            <>Menor proporção: <b className="font-extrabold text-destructive">{stages[bottleneckIdx].label} → {stages[bottleneckIdx + 1].label}</b></>
          ) : (
            hasData ? "Sem base para proporções" : "Sem dados no período"
          )}
        </span>
        {deltaPp !== null && (
          <b className={`text-[11px] font-extrabold ${deltaPp >= 0 ? "text-success" : "text-destructive"}`}>
            {deltaPp >= 0 ? "+" : ""}{deltaPp.toFixed(1).replace(".", ",")}pp {prevLabel}
          </b>
        )}
        <Link to="/funis" className="text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
          Ver funis →
        </Link>
      </div>
    </div>
  );
}

export const TrapezoidFunnel = memo(TrapezoidFunnelBase);
