import { memo } from "react";
import { Link } from "react-router-dom";

export interface TeamGoalGauge {
  label: string;
  current: number;
  target: number;
  /** Texto curto sob o gauge — ex.: "R$ 142K / 200K". */
  caption: string;
}

interface TeamGoalsGaugesProps {
  gauges: TeamGoalGauge[];
  /** % esperado pelo pacing do mês (dia X / dias). */
  expectedPercent: number;
}

function gaugeColor(pct: number, expected: number): string {
  if (pct >= expected * 1.1) return "hsl(var(--success))";
  if (pct >= expected * 0.9) return "hsl(var(--primary))";
  return "hsl(var(--destructive))";
}

/** Semicírculo SVG — arco 180° proporcional ao % (clampa em 100). */
function MiniGauge({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const angle = Math.PI * (1 - clamped / 100);
  const R = 38;
  const x = 46 + Math.cos(angle) * R;
  const y = 54 - Math.sin(angle) * R;
  // Gauge é um semicírculo de 180°, então o arco de preenchimento nunca passa
  // de meia-volta → large-arc-flag SEMPRE 0. Com flag 1 (acima de 50%) o SVG
  // desenhava o arco maior, que desce abaixo da base e era cortado pela altura
  // do svg, virando um segmento solto no topo.
  return (
    <svg width="92" height="58" viewBox="0 0 92 58" className="mx-auto mt-2 block">
      <path d="M 8 54 A 38 38 0 0 1 84 54" fill="none" stroke="hsl(var(--foreground) / .08)" strokeWidth={7} strokeLinecap="round" />
      {clamped > 1 && (
        <path
          d={`M 8 54 A 38 38 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`}
          fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
          style={color.includes("primary") ? { filter: "drop-shadow(0 0 4px hsl(var(--primary) / .4))" } : undefined}
        />
      )}
    </svg>
  );
}

/**
 * Metas da equipe — três mini-velocímetros (faturamento, clientes, reuniões)
 * com leitura de ritmo embaixo. DNA do gauge da Visão Geral em miniatura.
 */
function TeamGoalsGaugesBase({ gauges, expectedPercent }: TeamGoalsGaugesProps) {
  const behind = gauges
    .map((g) => ({ ...g, pct: g.target > 0 ? (g.current / g.target) * 100 : 0 }))
    .filter((g) => g.target > 0 && g.pct < expectedPercent * 0.9);

  return (
    // Corpo da janela "Metas da equipe" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
          title="As metas seguem mensais mesmo com período personalizado selecionado."
        >
          Equipe · metas do mês
        </span>
        <Link to="/gestao-metas" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
          Ajustar →
        </Link>
      </div>

      {gauges.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          Nenhuma meta configurada pra este mês.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(gauges.length, 3)}, minmax(0, 1fr))` }}>
            {gauges.map((g) => {
              const pct = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
              const color = gaugeColor(pct, expectedPercent);
              return (
                <div key={g.label} className="min-w-0 rounded-2xl bg-sunken px-2 py-3.5 text-center">
                  <span className="block truncate text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">{g.label}</span>
                  <MiniGauge pct={pct} color={color} />
                  <div className="-mt-[30px] text-[17px] font-extrabold tracking-[-0.04em] tabular-nums">{Math.round(pct)}%</div>
                  <div className="mt-3.5 truncate text-[11px] font-semibold text-muted-foreground">{g.caption}</div>
                </div>
              );
            })}
          </div>
          {behind.length > 0 && (
            <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
              <b className="font-extrabold text-destructive">
                {behind.map((b) => b.label).join(" e ")} abaixo do ritmo
              </b>{" "}
              — esperado {Math.round(expectedPercent)}% do mês até hoje.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const TeamGoalsGauges = memo(TeamGoalsGaugesBase);
