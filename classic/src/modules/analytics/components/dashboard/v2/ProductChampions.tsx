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
    return <Skeleton className="h-[300px] rounded-2xl" />;
  }

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".15s" }}>
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">Produtos campeões</span>
        <Link to="/produtos" className="text-[11.5px] font-bold text-muted-foreground transition-colors hover:text-primary">
          Catálogo →
        </Link>
      </div>
      <div className="mt-2.5">
        {top5.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhuma venda com produto no período.</p>
        )}
        {top5.map((p, i) => (
          <div
            key={p.product_id}
            className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-b border-border/70 py-2 last:border-b-0"
          >
            <span className="cmd-mono text-[10.5px] font-extrabold text-muted-foreground/60">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-[12.5px] font-semibold">
              {p.product_name}
              <small className="block text-[10.5px] font-semibold text-muted-foreground/60">
                {p.qty_sold} unidade{p.qty_sold === 1 ? "" : "s"} · ticket {formatK(p.ticket_medio)}
              </small>
            </span>
            <span className="text-right text-[13px] font-extrabold tabular-nums">{formatK(p.total_value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ProductChampions = memo(ProductChampionsBase);
