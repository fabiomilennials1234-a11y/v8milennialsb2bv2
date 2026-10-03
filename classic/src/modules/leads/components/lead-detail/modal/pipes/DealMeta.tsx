import { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { LeadDeal } from "../../../../hooks/useLeadsDeals";
import { dealBoardPath } from "../../../../lib/deal-board-path";

/**
 * Meta do negócio ao lado do trilho de etapas: valor, tempo parado e a ponte
 * pro funil. O trilho responde "onde está"; isto responde "quanto vale e há
 * quanto tempo não anda" — que é o que decide se o vendedor age hoje.
 */

/** Acima disso o negócio está esquecido — vira sinal, não decoração. */
const STALE_DAYS = 14;

interface DealMetaProps {
  deal?: LeadDeal;
  /** Nome do funil, usado só no rótulo acessível do link. */
  fallbackLabel: string;
}

export const DealMeta = memo(function DealMeta({ deal, fallbackLabel }: DealMetaProps) {
  const path = deal ? dealBoardPath(deal) : null;
  const stale = deal?.daysInStage != null && deal.daysInStage >= STALE_DAYS;

  return (
    <div className="flex shrink-0 items-center gap-2.5 pl-1">
      {deal && deal.value > 0 && (
        <span
          className={cn(
            "text-[11.5px] font-semibold tabular-nums",
            deal.outcome === "won" ? "text-success" : "text-foreground/80",
          )}
          data-testid={`deal-value-${deal.id}`}
        >
          {formatBRL(deal.value)}
        </span>
      )}

      {deal?.daysInStage != null && (
        <span
          className={cn(
            "text-[11px] tabular-nums",
            stale ? "font-semibold text-amber-500" : "text-muted-foreground/70",
          )}
          title={
            stale
              ? `Parado há ${deal.daysInStage} dias nesta etapa`
              : `Nesta etapa há ${deal.daysInStage} dias`
          }
          data-testid={`deal-age-${deal.id}`}
        >
          {deal.daysInStage}d
        </span>
      )}

      {path && (
        <Link
          to={path}
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1 py-0.5",
            "text-[11px] font-medium text-muted-foreground/70",
            "hover:text-foreground hover:bg-muted/60 transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={`Ver ${fallbackLabel} no funil`}
          data-testid={deal ? `deal-open-board-${deal.id}` : undefined}
        >
          Ver no funil
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      )}
    </div>
  );
});
