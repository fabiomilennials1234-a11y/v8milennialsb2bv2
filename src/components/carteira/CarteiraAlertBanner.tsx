import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";
import { formatBRL } from "@/lib/format";

interface CarteiraAlertBannerProps {
  onViewDetails?: () => void;
  className?: string;
}

export function CarteiraAlertBanner({ onViewDetails, className }: CarteiraAlertBannerProps) {
  const { data } = usePortfolioHealth();

  if (!data || data.overdueCount === 0) return null;

  const { overdueCount, overdueRevenue } = data;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl px-5 py-4",
        "bg-gradient-to-br from-[#451a03] to-[#78350f] border border-[#92400e]",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Zap size={20} className="shrink-0 text-[#fbbf24]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#fafafa]">
            {overdueCount} {overdueCount === 1 ? "cliente" : "clientes"} com recompra atrasada — {formatBRL(overdueRevenue)} em risco
          </p>
          <p className="text-[13px] text-[#fbbf24] mt-0.5">
            Copilot pode abordar automaticamente. Clientes estratégicos precisam de contato pessoal.
          </p>
        </div>
      </div>

      {onViewDetails && (
        <button
          onClick={onViewDetails}
          className="shrink-0 px-3.5 py-1.5 bg-[#eab308] text-[#09090b] rounded-md text-[13px] font-semibold hover:bg-[#facc15] transition-colors"
        >
          Ver detalhes
        </button>
      )}
    </div>
  );
}
