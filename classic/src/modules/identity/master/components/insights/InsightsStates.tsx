import { AlertTriangle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Bloco com brilho `animate-shimmer` (DESIGN §12). */
function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-muted/60", className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/5 to-transparent animate-shimmer" />
    </div>
  );
}

/** Loading: skeletons + Curva J como baseline reta tracejada respirando. */
export function InsightsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <ShimmerBlock className="h-[420px]" />
      </div>
      <div className="space-y-6 lg:col-span-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ShimmerBlock className="h-[92px]" />
          <ShimmerBlock className="h-[92px]" />
          <ShimmerBlock className="h-[92px]" />
        </div>
        <ShimmerBlock className="h-[170px]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ShimmerBlock className="h-[150px]" />
          <ShimmerBlock className="h-[150px]" />
        </div>
      </div>
      <div className="lg:col-span-12">
        <div className="flex h-[300px] items-center justify-center rounded-2xl border border-border bg-card">
          <div className="h-px w-2/3 animate-pulse border-t-2 border-dashed border-border" />
        </div>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  onRetry?: () => void;
}

export function InsightsErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-[360px] items-center justify-center">
      <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="mx-auto h-9 w-9 text-destructive" />
        <p className="mt-4 text-[15px] font-medium text-foreground">
          Não foi possível carregar os indicadores desta organização.
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Verifique a conexão e tente novamente.
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
            Tentar de novo
          </Button>
        )}
      </div>
    </div>
  );
}

interface NoSalesStateProps {
  onProjetar: () => void;
}

export function InsightsNoSalesState({ onProjetar }: NoSalesStateProps) {
  return (
    <div className="flex min-h-[360px] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
          <Receipt className="h-6 w-6 text-muted-foreground" />
        </span>
        <p className="mt-4 text-[15px] font-medium text-foreground">
          Esta organização ainda não tem vendas registradas.
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Os indicadores aparecem assim que houver a primeira venda.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-5 border-insights/30 text-insights hover:bg-insights/10 hover:text-insights"
          onClick={onProjetar}
        >
          Projetar um cenário meta →
        </Button>
      </div>
    </div>
  );
}
