import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { HelpArticleWithCategory } from "@/hooks/useHelpCenter";

interface HelpArticleDialogProps {
  article: HelpArticleWithCategory | null;
  articles: HelpArticleWithCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (article: HelpArticleWithCategory) => void;
}

export function HelpArticleDialog({
  article,
  articles,
  open,
  onOpenChange,
  onNavigate,
}: HelpArticleDialogProps) {
  if (!article) return null;

  const siblings = useMemo(
    () =>
      articles
        .filter((a) => a.category_id === article.category_id && a.is_published)
        .sort((a, b) => a.sort_order - b.sort_order),
    [articles, article.category_id]
  );

  const currentIndex = siblings.findIndex((a) => a.id === article.id);
  const prevArticle = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextArticle =
    currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  const mediaItems = Array.isArray(article.media) ? article.media : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            {article.category?.name}
          </div>
          <DialogTitle className="text-xl">{article.title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {article.content}
            </ReactMarkdown>
          </div>

          {mediaItems.length > 0 && (
            <div className="mt-6 space-y-4">
              {mediaItems.map((media, i) => (
                <figure key={i} className="rounded-lg overflow-hidden border border-border">
                  <img
                    src={media.url}
                    alt={media.caption || `Imagem ${i + 1}`}
                    className="w-full h-auto"
                    loading="lazy"
                  />
                  {media.caption && (
                    <figcaption className="text-xs text-muted-foreground text-center py-2 px-3 bg-muted/50">
                      {media.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
        </ScrollArea>

        {(prevArticle || nextArticle) && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-border">
            {prevArticle ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => onNavigate(prevArticle)}
              >
                <ChevronLeft className="w-4 h-4" />
                {prevArticle.title}
              </Button>
            ) : (
              <div />
            )}
            {nextArticle && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => onNavigate(nextArticle)}
              >
                {nextArticle.title}
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
