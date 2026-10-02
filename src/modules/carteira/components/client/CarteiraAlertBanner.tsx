import { ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolioKPIs } from "@/modules/carteira/hooks/usePortfolioKPIs";
import { formatBRL } from "@/lib/format";

interface CarteiraAlertBannerProps {
  onViewDetails?: () => void;
  className?: string;
}

export function CarteiraAlertBanner({ onViewDetails, className }: CarteiraAlertBannerProps) {
  const { data } = usePortfolioKPIs();

  if (!data || data.overdue_count === 0) return null;

  const { overdue_count: overdueCount, overdue_revenue: overdueRevenue } = data;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-warning/30 bg-warning/10 px-5 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warning/20 text-warning-strong">
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            {overdueCount} {overdueCount === 1 ? "cliente" : "clientes"} com recompra atrasada —{" "}
            <span className="tabular-nums">{formatBRL(overdueRevenue)}</span> em risco
          </p>
          <p className="mt-0.5 text-[13px] text-warning-strong">
            Copilot pode abordar automaticamente. Clientes estratégicos precisam de contato pessoal.
          </p>
        </div>
      </div>

      {onViewDetails && (
        <Button size="sm" variant="ink" onClick={onViewDetails} className="shrink-0">
          Ver detalhes
          <ArrowRight />
        </Button>
      )}
    </div>
  );
}
