import * as Icons from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpArticleCard } from "./HelpArticleCard";
import type { HelpCategory, HelpArticleWithCategory } from "@/modules/platform/hooks/useHelpCenter";

interface HelpCategoryAccordionProps {
  categories: HelpCategory[];
  articles: HelpArticleWithCategory[];
  onArticleClick: (article: HelpArticleWithCategory) => void;
  excludeSlug?: string;
}

function getLucideIcon(iconName: string) {
  const icons = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return icons[iconName] || Icons.HelpCircle;
}

export function HelpCategoryAccordion({
  categories,
  articles,
  onArticleClick,
  excludeSlug,
}: HelpCategoryAccordionProps) {
  const filteredCategories = categories.filter(
    (c) => c.slug !== excludeSlug
  );

  return (
    <Accordion type="multiple" className="space-y-2">
      {filteredCategories.map((category) => {
        const categoryArticles = articles.filter(
          (a) => a.category_id === category.id && a.is_published
        );
        const Icon = getLucideIcon(category.icon);

        return (
          <AccordionItem
            key={category.id}
            value={category.id}
            className="border rounded-lg px-4"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-md bg-primary/10">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="text-left">
                  <span className="font-medium">{category.name}</span>
                  {category.description && (
                    <p className="text-xs text-muted-foreground font-normal">
                      {category.description}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="ml-2 text-xs">
                  {categoryArticles.length}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {categoryArticles.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum artigo nesta categoria ainda.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {categoryArticles.map((article) => (
                    <HelpArticleCard
                      key={article.id}
                      article={article}
                      onClick={() => onArticleClick(article)}
                    />
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
