import { memo, useMemo } from "react";
import { useSellerActivity } from "@/modules/engagement";
import { Skeleton } from "@/components/ui/skeleton";

interface TeamActivityCardProps {
  /** Intervalo global do Comando — atividade segue o período selecionado. */
  range: { start: Date; end: Date };
}

const BAR_COLORS = [
  "linear-gradient(90deg, hsl(47 100% 44%), hsl(47 100% 50%))",
  "hsl(200 80% 50% / .8)",
  "hsl(280 55% 55% / .8)",
  "hsl(142 70% 45% / .8)",
  "hsl(16 75% 55% / .8)",
  "hsl(330 60% 55% / .8)",
];
const AV_COLORS = [
  "linear-gradient(135deg, hsl(47 100% 50%), hsl(36 100% 58%))",
  "hsl(200 80% 50%)",
  "hsl(280 55% 55%)",
  "hsl(142 70% 45%)",
  "hsl(16 75% 55%)",
  "hsl(330 60% 55%)",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Atividade da equipe — uma linha por vendedor com total de ações no período,
 * barra comparativa e breakdown explícito (leads, follow-ups, reuniões, propostas).
 * Substitui o SellerActivityCard (score abstrato) por leitura direta.
 */
function TeamActivityCardBase({ range }: TeamActivityCardProps) {
  const { data: sellers, isLoading } = useSellerActivity(undefined, undefined, range);

  const rows = useMemo(() => {
    const list = (sellers ?? []).map((s) => ({
      ...s,
      total: s.leads + s.followups + s.reunioes + s.propostas + s.vendas,
    }));
    list.sort((a, b) => b.total - a.total);
    const max = list[0]?.total ?? 0;
    const avg = list.length ? list.reduce((acc, s) => acc + s.total, 0) / list.length : 0;
    return list.map((s, i) => ({
      ...s,
      pct: max > 0 ? (s.total / max) * 100 : 0,
      note: i === 0 && s.total > 0
        ? "mais ativo do mês"
        : avg > 0 && s.total < avg * 0.62
          ? `atenção: ${Math.round((1 - s.total / avg) * 100)}% abaixo da média`
          : "",
      colorIdx: i % BAR_COLORS.length,
      belowAvg: avg > 0 && s.total < avg * 0.62,
    }));
  }, [sellers]);

  if (isLoading) {
    return <Skeleton className="h-[300px] rounded-2xl" />;
  }

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".2s" }}>
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">Atividade da equipe</span>
        <span className="text-[11px] font-semibold text-muted-foreground/60">
          tudo que cada vendedor fez no período: leads, follow-ups, reuniões e propostas
        </span>
      </div>
      <div className="mt-2.5">
        {rows.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Sem atividade registrada no período.</p>
        )}
        {rows.map((s) => (
          <div
            key={s.id}
            className="grid grid-cols-[34px_130px_1fr_auto] items-center gap-3 border-b border-border/70 py-2.5 last:border-b-0"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[11px] font-extrabold text-background"
              style={{ background: AV_COLORS[s.colorIdx] }}
            >
              {initials(s.name)}
            </span>
            <span className="text-[12.5px] font-bold">
              {s.name}
              <small className={`block text-[10px] font-semibold ${s.belowAvg ? "text-destructive" : "text-muted-foreground/60"}`}>
                {s.note || " "}
              </small>
            </span>
            <div className="relative h-[18px] overflow-hidden rounded-md bg-background">
              <i
                className="absolute inset-y-0 left-0 rounded-md"
                style={{ width: `${s.pct}%`, background: BAR_COLORS[s.colorIdx] }}
              />
              <span className={`absolute left-[9px] top-1/2 z-[1] -translate-y-1/2 text-[10.5px] font-extrabold ${s.colorIdx === 0 ? "text-background" : ""}`}>
                {s.total} aç{s.total === 1 ? "ão" : "ões"}
              </span>
            </div>
            <span className="flex gap-3 whitespace-nowrap text-[10.5px] font-semibold text-muted-foreground/60">
              <span><b className="font-extrabold text-foreground">{s.leads}</b> leads</span>
              <span><b className="font-extrabold text-foreground">{s.followups}</b> follow-ups</span>
              <span><b className="font-extrabold text-foreground">{s.reunioes}</b> reuniões</span>
              <span><b className="font-extrabold text-foreground">{s.propostas}</b> propostas</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const TeamActivityCard = memo(TeamActivityCardBase);
