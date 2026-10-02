import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { IconChip, type Tone } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/shared/hooks/useCountUp";

export type KpiFormat = "int" | "currencyK" | "minutes" | "percent";

export interface KpiDelta {
  label: string;
  tone: "up" | "down";
}

interface KpiCardCompactProps {
  label: string;
  value: number | null;
  format: KpiFormat;
  delta?: KpiDelta;
  caption: string;
  quickActionLabel: string;
  quickActionTo: string;
  /** Sem efeito desde o V5: a entrada animada brigava com o levantar do hover. */
  delay?: number;
  /** V5 (onda "mais perto do mockup"): o chip tintado do `KpiTile`. */
  icon?: LucideIcon;
  tone?: Tone;
}

function formatValue(value: number | null, format: KpiFormat): string {
  if (value === null) return "—";
  switch (format) {
    case "currencyK":
      if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
      if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1).replace(".", ",")}K`;
      return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
    case "minutes":
      if (value >= 60) return `${(value / 60).toFixed(1).replace(".", ",")}h`;
      return `${Math.round(value)}min`;
    case "percent":
      return `${Math.round(value)}%`;
    default:
      return Math.round(value).toLocaleString("pt-BR");
  }
}

/**
 * KPI compacto dos indicadores da operação — delta, comparativo textual e
 * quick action que sobe do rodapé no hover (padrão aprovado no mockup v3).
 *
 * V5 (2026-10): mesma anatomia do `KpiTile` (cartão de bento, rótulo, número
 * herói tabular, nota) — continua um BOTÃO inteiro porque o cartão é a porta
 * para a tela do assunto.
 */
function KpiCardCompactBase({
  label, value, format, delta, caption, quickActionLabel, quickActionTo, icon, tone = "neutral",
}: KpiCardCompactProps) {
  const navigate = useNavigate();
  const animated = useCountUp(value ?? 0, 1300, true);

  return (
    <button
      type="button"
      onClick={() => navigate(quickActionTo)}
      className={cn(
        "group relative flex h-full min-h-[96px] w-full min-w-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-card border border-card-border bg-card px-[18px] pb-4 pt-[15px] text-left text-card-foreground shadow-relevo",
        "transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={`${label}: ${formatValue(value, format)}. ${quickActionLabel}`}
    >
      {/* Anatomia do KpiTile: rótulo + chip tintado no topo, número-herói, a
          variação logo abaixo (seta + %) e o comparativo em texto. */}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground/80">{label}</span>
        {icon && <IconChip icon={icon} tone={tone} size="sm" />}
      </div>
      <div className="text-[1.65rem] font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums">
        {formatValue(value === null ? null : animated, format)}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {delta && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 font-bold tabular-nums",
              delta.tone === "up" ? "text-success-strong" : "text-destructive",
            )}
          >
            {delta.tone === "up" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
            {delta.label.replace(/^[+-]/, "")}
          </span>
        )}
        <span className="min-w-0 truncate text-muted-foreground">{caption}</span>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 translate-y-full bg-primary-soft py-1.5 text-center text-[11px] font-bold text-primary-soft-foreground transition-transform duration-200 [transition-timing-function:cubic-bezier(.22,1,.36,1)] group-hover:translate-y-0 group-focus-visible:translate-y-0 motion-reduce:transition-none"
      >
        {quickActionLabel}
      </div>
    </button>
  );
}

export const KpiCardCompact = memo(KpiCardCompactBase);
