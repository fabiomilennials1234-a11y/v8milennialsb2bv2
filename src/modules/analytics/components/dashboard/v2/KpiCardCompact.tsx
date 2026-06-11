import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/shared/hooks/useCountUp";

export type KpiFormat = "int" | "currencyK" | "minutes" | "percent";

export interface KpiDelta {
  label: string;
  tone: "up" | "down";
}

interface KpiCardCompactProps {
  label: string;
  value: number;
  format: KpiFormat;
  delta?: KpiDelta;
  caption: string;
  quickActionLabel: string;
  quickActionTo: string;
  delay?: number;
}

function formatValue(value: number, format: KpiFormat): string {
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
 * KPI compacto da Central de Comando — delta badge, comparativo textual e
 * quick action que sobe do rodapé no hover (padrão aprovado no mockup v3).
 */
function KpiCardCompactBase({
  label, value, format, delta, caption, quickActionLabel, quickActionTo, delay = 0,
}: KpiCardCompactProps) {
  const navigate = useNavigate();
  const animated = useCountUp(value, 1300, true);

  return (
    <button
      type="button"
      onClick={() => navigate(quickActionTo)}
      className="cmd-cell cmd-rise group block h-full min-h-[96px] w-full cursor-pointer px-[15px] pb-3.5 pt-[13px] text-left"
      style={{ animationDelay: `${delay}s` }}
      aria-label={`${label}: ${formatValue(value, format)}. ${quickActionLabel}`}
    >
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">{label}</span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[7px] px-[7px] py-[2.5px] text-[11px] font-bold",
              delta.tone === "up" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
            )}
          >
            {delta.label}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[21px] font-extrabold tracking-[-0.035em] tabular-nums">
        {formatValue(animated, format)}
      </div>
      <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">{caption}</div>
      <div
        className="absolute inset-x-0 bottom-0 translate-y-full bg-primary/15 py-[5px] text-center text-[10.5px] font-bold text-primary transition-transform duration-200 [transition-timing-function:cubic-bezier(.22,1,.36,1)] group-hover:translate-y-0 group-focus-visible:translate-y-0"
      >
        {quickActionLabel}
      </div>
    </button>
  );
}

export const KpiCardCompact = memo(KpiCardCompactBase);
