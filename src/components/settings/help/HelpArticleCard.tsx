import { motion } from "framer-motion";
import { FileText, Lightbulb, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HelpArticle } from "@/hooks/useHelpCenter";

interface HelpArticleCardProps {
  article: HelpArticle;
  onClick: () => void;
}

const typeBadge: Record<string, { label: string; icon: typeof FileText }> = {
  guia: { label: "Guia", icon: BookOpen },
  dica: { label: "Dica", icon: Lightbulb },
  default: { label: "Artigo", icon: FileText },
};

function getArticleBadge(tags: string[]) {
  if (tags.includes("guia")) return typeBadge.guia;
  if (tags.includes("dica")) return typeBadge.dica;
  return typeBadge.default;
}

export function HelpArticleCard({ article, onClick }: HelpArticleCardProps) {
  const badge = getArticleBadge(article.tags || []);
  const Icon = badge.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-1">
            {article.title}
          </h4>
          {article.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {article.summary}
            </p>
          )}
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs gap-1">
          <Icon className="w-3 h-3" />
          {badge.label}
        </Badge>
      </div>
    </motion.button>
  );
}
