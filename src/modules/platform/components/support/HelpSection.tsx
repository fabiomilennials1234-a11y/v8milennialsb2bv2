import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { BookOpen, ChevronRight, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useHelpArticles } from "@/modules/platform/hooks/useHelpCenter";
import { rankHelpArticles } from "@/modules/platform/lib/help-suggestions";
import type { HelpArticleWithCategory } from "@/modules/platform/hooks/useHelpCenter";

interface Props {
  onOpenArticle: (article: HelpArticleWithCategory) => void;
}

/**
 * A camada de deflexão: ajuda antes de humano.
 *
 * Some por inteiro quando não há artigo publicado. Um bloco "Artigos" vazio é
 * pior que sua ausência — sinaliza que ali não existe ajuda. Hoje o corpus em
 * produção está vazio; quando o primeiro artigo for escrito, isto liga sozinho.
 */
export function HelpSection({ onOpenArticle }: Props) {
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const { data: articles = [], isLoading } = useHelpArticles();

  const published = useMemo(() => articles.filter((a) => a.is_published), [articles]);

  const ranked = useMemo(
    () => rankHelpArticles(published, { pathname, query }),
    [published, pathname, query],
  );

  if (isLoading || published.length === 0) return null;

  const searching = query.trim().length >= 3;

  return (
    <div className="border-b border-border/40 pb-4">
      <div className="px-6 pt-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar na central de ajuda…"
            className="h-9 pl-9 text-sm"
            aria-label="Buscar na central de ajuda"
          />
        </div>

        {!searching && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" aria-hidden />
            Sugerido para <code className="rounded bg-muted/60 px-1 py-0.5">{pathname}</code>
          </p>
        )}
      </div>

      <div className="mt-2">
        {ranked.length === 0 ? (
          <p className="px-6 py-3 text-xs text-muted-foreground">
            Nenhum artigo para “{query.trim()}”.
          </p>
        ) : (
          <ul>
            {ranked.map((article) => (
              <li key={article.id}>
                <button
                  type="button"
                  onClick={() => onOpenArticle(article)}
                  className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/30">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{article.title}</span>
                    {article.summary && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {article.summary}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
