import { memo } from "react";
import { Link } from "react-router-dom";
import { useProductRanking } from "@/modules/carteira";
import { Skeleton } from "@/components/ui/skeleton";

interface ProductChampionsProps {
  /** Intervalo global do Comando — produtos seguem o período selecionado. */
  range: { start: Date; end: Date };
}

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1).replace(".", ",")}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/** Produtos campeões — top 5 por receita no período. */
function ProductChampionsBase({ range }: ProductChampionsProps) {
  const { data: products, isLoading } = useProductRanking(undefined, undefined, range);
  const top5 = (products ?? []).slice(0, 5);

  if (isLoading) {
    return <Skeleton className="h-full min-h-[200px] rounded-2xl" />;
  }

  return (
    // Corpo da janela "Campeões de produto" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end">
        <Link to="/produtos" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
          Catálogo →
        </Link>
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        {top5.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhuma venda com produto no período.</p>
        )}
        {top5.map((p, i) => (
          <div
            key={p.product_id}
            className="grid grid-cols-[26px_1fr_auto] items-center gap-2.5 border-b border-border/60 py-2.5 last:border-b-0"
          >
            <span className={i === 0
              ? "grid h-6 w-6 place-items-center rounded-lg bg-primary-soft text-[11px] font-extrabold tabular-nums text-primary-soft-foreground"
              : "grid h-6 w-6 place-items-center rounded-lg bg-muted text-[11px] font-extrabold tabular-nums text-muted-foreground"}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 truncate text-[13px] font-semibold">
              {p.product_name}
              <small className="block truncate text-[11px] font-medium text-muted-foreground">
                {p.qty_sold} unidade{p.qty_sold === 1 ? "" : "s"} · ticket {formatK(p.ticket_medio)}
              </small>
            </span>
            <span className="text-right text-[13px] font-extrabold tracking-[-0.02em] tabular-nums">{formatK(p.total_value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ProductChampions = memo(ProductChampionsBase);
