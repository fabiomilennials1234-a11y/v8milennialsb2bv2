import { useCountUp } from "@/shared/hooks/useCountUp";
import { cn } from "@/lib/utils";
import { formatBRL, formatCompras } from "./lib/format";

interface PaybackCardProps {
  eyebrow: string;
  /** Nº de compras p/ recuperar o CAC. `null` = payback impossível. */
  payback: number | null;
  /** Fórmula conceitual (ex.: "P1 = CAC ÷ margem por venda"). */
  conceptFormula: string;
  cac: number | null;
  /** Denominador da fórmula (margem por venda / margem com LTV). */
  denomLabel: string;
  denomValue: number | null;
  /** Microcopy quando o payback é impossível. */
  impossibleNote: string;
}

function healthBorder(payback: number | null): string {
  if (payback === null) return "border-t-border";
  if (payback <= 1.05) return "border-t-success";
  if (payback <= 3) return "border-t-insights";
  return "border-t-warning";
}

/**
 * Card de payback (DESIGN §9). Fórmula sempre visível (conceitual + substituição
 * numérica). Borda-topo de saúde por faixa. Fórmulas exatas = donas da calc lib.
 */
export function PaybackCard({
  eyebrow,
  payback,
  conceptFormula,
  cac,
  denomLabel,
  denomValue,
  impossibleNote,
}: PaybackCardProps) {
  const animated = useCountUp(payback ?? 0, 600, payback !== null);

  return (
    <div
      className={cn(
        "rounded-card border border-card-border bg-card text-card-foreground shadow-relevo border-t-2 p-6",
        healthBorder(payback),
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
        {eyebrow}
      </p>

      {payback === null ? (
        <>
          <p className="mt-3 text-4xl font-extrabold leading-none tabular-nums tracking-[-0.04em] text-muted-foreground">
            —
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {impossibleNote}
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold leading-none tabular-nums tracking-[-0.04em] text-foreground">
              {formatCompras(animated)}
            </span>
            <span className="text-sm font-medium text-muted-foreground">compras</span>
          </p>
          <div className="mt-4 space-y-1 rounded-xl bg-sunken px-3 py-2.5 font-mono text-[12px] leading-relaxed">
            <p className="text-muted-foreground">{conceptFormula}</p>
            <p className="text-foreground/70">
              = {formatBRL(cac ?? 0)} ÷ {formatBRL(denomValue ?? 0)} ={" "}
              {formatCompras(payback)} compras
            </p>
            <p className="sr-only">{denomLabel}</p>
          </div>
        </>
      )}
    </div>
  );
}
