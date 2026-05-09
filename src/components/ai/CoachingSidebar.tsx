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
} from "@/hooks/useCoachingSuggestions";
import { cn } from "@/lib/utils";

// ── Suggestion type config ────────────────────────────────────

const SUGGESTION_CONFIG: Record<SuggestionType, { icon: typeof Brain; color: string; label: string }> = {
  response: { icon: MessageSquare, color: "text-blue-500", label: "Resposta" },
  objection_handling: { icon: Shield, color: "text-purple-500", label: "Objecao" },
  tone_alert: { icon: AlertTriangle, color: "text-amber-500", label: "Tom" },
  battle_card: { icon: Swords, color: "text-red-500", label: "Battlecard" },
  upsell_opportunity: { icon: TrendingUp, color: "text-emerald-500", label: "Upsell" },
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
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/50 bg-card hover:bg-muted transition-colors",
          suggestions.length > 0 && "border-primary/30"
        )}
        title="Abrir coaching IA"
      >
        <Brain className="w-4 h-4 text-primary" />
        {suggestions.length > 0 && (
          <Badge variant="default" className="h-5 w-5 p-0 flex items-center justify-center text-[10px]">
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
      className="border-l border-border bg-card flex flex-col h-full overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Coaching IA</span>
          {suggestions.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {suggestions.length}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
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
                Nenhuma sugestao no momento. Continue a conversa.
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
                    className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2"
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
