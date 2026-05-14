import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

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
        "flex items-center justify-between gap-4 rounded-lg px-4 py-3",
        "bg-amber-500/10 border border-amber-500/20 border-l-[3px] border-l-[hsl(47_100%_50%)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle
          size={16}
          className="shrink-0 text-amber-400"
          aria-hidden="true"
        />
        <p className="text-sm text-amber-200 truncate">
          <span className="font-semibold text-amber-100">{overdueCount}</span>
          {overdueCount === 1 ? " cliente com" : " clientes com"} recompra atrasada —{" "}
          <span className="font-semibold text-amber-100">{formatBRL(overdueRevenue)}</span> em risco
        </p>
      </div>

      {onViewDetails && (
        <Button
          variant="outline"
          size="sm"
          onClick={onViewDetails}
          className="shrink-0 h-7 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/20 hover:text-amber-100 hover:border-amber-500/60"
        >
          Ver detalhes
        </Button>
      )}
    </div>
  );
}
