import { useState, useMemo } from "react";
import { HelpCircle, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useUserRole";
import {
  useHelpCategories,
  useHelpArticles,
  type HelpArticleWithCategory,
} from "@/hooks/useHelpCenter";
import { HelpSearchBar } from "./HelpSearchBar";
import { HelpGettingStarted } from "./HelpGettingStarted";
import { HelpCategoryAccordion } from "./HelpCategoryAccordion";
import { HelpArticleDialog } from "./HelpArticleDialog";
import { HelpAdminPanel } from "./HelpAdminPanel";
import { HelpArticleCard } from "./HelpArticleCard";

export function HelpCenter() {
  const { isAdmin } = useIsAdmin();
  const { data: categories = [], isLoading: loadingCats } = useHelpCategories();
  const { data: articles = [], isLoading: loadingArticles } = useHelpArticles();

  const [search, setSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<HelpArticleWithCategory | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  const filteredArticles = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return articles.filter(
      (a) =>
        a.is_published &&
        (a.title.toLowerCase().includes(q) ||
          (a.summary || "").toLowerCase().includes(q) ||
          (a.tags || []).some((t) => t.toLowerCase().includes(q)))
    );
  }, [articles, search]);

  const isSearching = search.trim().length > 0;

  const handleArticleClick = (article: HelpArticleWithCategory) => {
    setSelectedArticle(article);
    setDialogOpen(true);
  };

  const handleNavigate = (article: HelpArticleWithCategory) => {
    setSelectedArticle(article);
  };

  const isLoading = loadingCats || loadingArticles;

  if (showAdmin && isAdmin) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => setShowAdmin(false)}
        >
          <HelpCircle className="w-4 h-4" />
          Voltar para Central de Ajuda
        </Button>
        <HelpAdminPanel />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-primary" />
            Central de Ajuda
          </h3>
          <p className="text-sm text-muted-foreground">
            Aprenda a usar todas as funcionalidades do sistema
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setShowAdmin(true)}
          >
            <Settings2 className="w-4 h-4" />
            Gerenciar
          </Button>
        )}
      </div>

      {/* Search */}
      <HelpSearchBar value={search} onChange={setSearch} />

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : isSearching ? (
        /* Search Results */
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {filteredArticles.length} resultado{filteredArticles.length !== 1 ? "s" : ""} para "{search}"
          </p>
          {filteredArticles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
              Nenhum artigo encontrado para sua busca.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filteredArticles.map((article) => (
                <HelpArticleCard
                  key={article.id}
                  article={article}
                  onClick={() => handleArticleClick(article)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Normal View */
        <div className="space-y-8">
          {/* Getting Started */}
          <HelpGettingStarted
            articles={articles}
            onArticleClick={handleArticleClick}
          />

          {/* Categories */}
          {categories.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Categorias</h3>
              <HelpCategoryAccordion
                categories={categories}
                articles={articles}
                onArticleClick={handleArticleClick}
                excludeSlug="primeiros-passos"
              />
            </div>
          )}

          {categories.length === 0 && articles.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
              <HelpCircle className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p>A central de ajuda está vazia.</p>
              {isAdmin && (
                <p className="text-sm mt-1">
                  Clique em "Gerenciar" para adicionar categorias e artigos.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Article Dialog */}
      <HelpArticleDialog
        article={selectedArticle}
        articles={articles}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
