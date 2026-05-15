import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortfolioKPIs } from "@/hooks/usePortfolioKPIs";
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
        "flex items-center justify-between gap-4 rounded-xl px-5 py-4",
        "bg-amber-500/10 border border-amber-500/20",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Zap size={20} className="shrink-0 text-amber-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {overdueCount} {overdueCount === 1 ? "cliente" : "clientes"} com recompra atrasada — {formatBRL(overdueRevenue)} em risco
          </p>
          <p className="text-[13px] text-amber-600 dark:text-amber-400 mt-0.5">
            Copilot pode abordar automaticamente. Clientes estratégicos precisam de contato pessoal.
          </p>
        </div>
      </div>

      {onViewDetails && (
        <button
          onClick={onViewDetails}
          className="shrink-0 px-3.5 py-1.5 bg-primary text-primary-foreground rounded-md text-[13px] font-semibold hover:bg-primary/90 transition-colors"
        >
          Ver detalhes
        </button>
      )}
    </div>
  );
}
