/**
 * CoachingSidebar — contextual AI coaching suggestions for chat.
 * Consumes useCoachingSuggestions, useMarkSuggestionUsed, useDismissSuggestion.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  MessageSquare,
  Shield,
  AlertTriangle,
  TrendingUp,
  Swords,
  Copy,
  Check,
  X,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCoachingSuggestions,
  useMarkSuggestionUsed,
  useDismissSuggestion,
  type SuggestionType,
} from "@/modules/engagement/hooks/useCoachingSuggestions";
import { cn } from "@/lib/utils";

// ── Suggestion type config ────────────────────────────────────

const SUGGESTION_CONFIG: Record<SuggestionType, { icon: typeof Brain; color: string; label: string }> = {
  response: { icon: MessageSquare, color: "text-foreground/70", label: "Resposta" },
  objection_handling: { icon: Shield, color: "text-insights", label: "Objeção" },
  tone_alert: { icon: AlertTriangle, color: "text-warning-strong", label: "Tom" },
  battle_card: { icon: Swords, color: "text-destructive", label: "Battlecard" },
  upsell_opportunity: { icon: TrendingUp, color: "text-success", label: "Upsell" },
};

// ── Types ─────────────────────────────────────────────────────

interface CoachingSidebarProps {
  conversationId: string | null;
  isOpen: boolean;
  onToggle: () => void;
}

// ── Component ─────────────────────────────────────────────────

export function CoachingSidebar({ conversationId, isOpen, onToggle }: CoachingSidebarProps) {
  const { data: suggestions = [] } = useCoachingSuggestions(conversationId);
  const markUsed = useMarkSuggestionUsed();
  const dismiss = useDismissSuggestion();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    markUsed.mutate(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Collapsed toggle button
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-xl border border-card-border bg-card px-2.5 shadow-relevo transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-relevo-alto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          suggestions.length > 0 && "ring-1 ring-primary/40"
        )}
        title="Abrir coaching IA"
        aria-label="Abrir coaching IA"
      >
        <Brain className="h-4 w-4 text-primary-soft-foreground" />
        {suggestions.length > 0 && (
          <Badge variant="default" className="flex h-5 w-5 items-center justify-center p-0 text-[10px] font-extrabold">
            {suggestions.length}
          </Badge>
        )}
      </button>
    );
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="ml-2 flex h-full flex-col overflow-hidden rounded-panel border border-card-border bg-card shadow-relevo md:ml-3"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            <Brain className="h-4 w-4" />
          </span>
          <span className="text-sm font-bold tracking-tight">Coaching IA</span>
          {suggestions.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {suggestions.length}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onToggle} aria-label="Fechar coaching IA">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {suggestions.length === 0 ? (
            <div className="text-center py-8">
              <Sparkles className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Nenhuma sugestão no momento. Continue a conversa.
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {suggestions.map((suggestion) => {
                const config = SUGGESTION_CONFIG[suggestion.suggestion_type] || SUGGESTION_CONFIG.response;
                const Icon = config.icon;
                const isCopied = copiedId === suggestion.id;

                return (
                  <motion.div
                    key={suggestion.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 50 }}
                    className="space-y-2 rounded-2xl border border-border/60 bg-sunken p-3"
                  >
                    {/* Type badge */}
                    <div className="flex items-center justify-between">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] gap-1", config.color)}
                      >
                        <Icon className="w-3 h-3" />
                        {config.label}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => dismiss.mutate(suggestion.id)}
                        title="Dispensar"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Content */}
                    <p className="text-xs leading-relaxed">{suggestion.content}</p>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 flex-1"
                        onClick={() => handleCopy(suggestion.id, suggestion.content)}
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-success" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {isCopied ? "Copiado" : "Copiar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => markUsed.mutate(suggestion.id)}
                      >
                        Usar
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  );
}
