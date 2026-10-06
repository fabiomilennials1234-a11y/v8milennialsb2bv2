import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LeadsPageSegmentsProps {
  /** Página atual, base 0. */
  page: number;
  /**
   * Índice da última página quando o total é EXATO; `null` quando a contagem
   * bateu no teto (`lib/capped-count`) e o fim do recorte ainda não é conhecido.
   */
  lastPage: number | null;
  /** Existe página depois desta? Com teto, é "esta página veio cheia". */
  hasNext: boolean;
  onChange: (page: number) => void;
}

/**
 * Páginas em segmentado (mockup V5): ‹ 1 2 3 … 48 ›. Mostra a primeira, a
 * vizinhança da atual e — quando o total é conhecido — a última. 48 botões
 * não cabem e não ajudam.
 *
 * Com a contagem no teto não há "última": o botão sumiria para a página 20 e
 * esconderia o resto. A navegação segue pela vizinhança e pelo "Próxima"
 * enquanto a página vem cheia.
 */
export function LeadsPageSegments({ page, lastPage, hasNext, onChange }: LeadsPageSegmentsProps) {
  const candidates = [0, page - 1, page, hasNext ? page + 1 : -1];
  if (lastPage !== null) candidates.push(lastPage);
  const max = lastPage ?? Number.POSITIVE_INFINITY;
  const sorted = [...new Set(candidates.filter((p) => p >= 0 && p <= max))].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push("gap");
    items.push(p);
  });
  const seg = "inline-grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-bold tabular-nums transition-colors";
  return (
    <nav aria-label="Paginação" className="inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px]">
      <button
        type="button"
        className={cn(seg, "text-muted-foreground hover:text-foreground disabled:opacity-40")}
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        aria-label="Anterior"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {items.map((it, i) =>
        it === "gap" ? (
          <span key={`gap-${i}`} className={cn(seg, "text-muted-foreground")} aria-hidden>…</span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            aria-current={it === page ? "page" : undefined}
            aria-label={`Página ${it + 1}`}
            className={cn(seg, it === page ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground")}
          >
            {(it + 1).toLocaleString("pt-BR")}
          </button>
        ),
      )}
      <button
        type="button"
        className={cn(seg, "text-muted-foreground hover:text-foreground disabled:opacity-40")}
        onClick={() => onChange(page + 1)}
        disabled={!hasNext}
        aria-label="Próxima"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </nav>
  );
}
