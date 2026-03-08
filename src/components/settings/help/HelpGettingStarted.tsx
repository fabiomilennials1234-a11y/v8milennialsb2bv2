import { motion } from "framer-motion";
import {
  Rocket,
  MessageSquare,
  LayoutGrid,
  Bot,
} from "lucide-react";
import type { HelpArticleWithCategory } from "@/hooks/useHelpCenter";

interface HelpGettingStartedProps {
  articles: HelpArticleWithCategory[];
  onArticleClick: (article: HelpArticleWithCategory) => void;
}

const fallbackCards = [
  {
    icon: MessageSquare,
    title: "Conectar WhatsApp",
    description: "Configure sua instância e comece a receber mensagens",
    slug: "conectar-whatsapp",
  },
  {
    icon: LayoutGrid,
    title: "Criar primeiro funil",
    description: "Organize seus leads em etapas de vendas",
    slug: "criar-funil",
  },
  {
    icon: Bot,
    title: "Configurar Copilot IA",
    description: "Crie agentes inteligentes para automatizar atendimentos",
    slug: "configurar-copilot",
  },
  {
    icon: Rocket,
    title: "Importar leads",
    description: "Traga seus contatos para o sistema rapidamente",
    slug: "importar-leads",
  },
];

export function HelpGettingStarted({ articles, onArticleClick }: HelpGettingStartedProps) {
  const gettingStartedArticles = articles.filter(
    (a) => a.category?.slug === "primeiros-passos" && a.is_published
  );

  const hasArticles = gettingStartedArticles.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Rocket className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Primeiros Passos</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {hasArticles
          ? gettingStartedArticles.slice(0, 4).map((article, i) => (
              <motion.button
                key={article.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => onArticleClick(article)}
                className="text-left p-4 rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary/40 hover:from-primary/10 hover:to-primary/20 transition-all cursor-pointer group"
              >
                <h4 className="font-medium text-sm group-hover:text-primary transition-colors">
                  {article.title}
                </h4>
                {article.summary && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {article.summary}
                  </p>
                )}
              </motion.button>
            ))
          : fallbackCards.map((card, i) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={card.slug}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="p-4 rounded-xl border-2 border-dashed border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10"
                >
                  <Icon className="w-5 h-5 text-primary mb-2" />
                  <h4 className="font-medium text-sm">{card.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {card.description}
                  </p>
                </motion.div>
              );
            })}
      </div>
    </div>
  );
}
