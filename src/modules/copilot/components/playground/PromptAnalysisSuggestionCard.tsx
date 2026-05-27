import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Check, X, ChevronDown, MessageSquare } from "lucide-react";
import type { PromptSuggestion } from "@/modules/copilot/hooks/usePromptAnalysis";

const SECTION_LABELS: Record<string, string> = {
  personality: "Personalidade",
  objective: "Objetivo",
  flow: "Fluxo",
  products: "Produtos",
  instructions: "Instruções",
  business_context: "Contexto de Negócio",
  conversation_style: "Estilo de Conversa",
};

const TYPE_LABELS: Record<string, string> = {
  add: "Adicionar",
  rewrite: "Reescrever",
  remove: "Remover",
};

interface Props {
  suggestion: PromptSuggestion;
  isAccepted: boolean;
  isDismissed: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  isApplying: boolean;
}

export function PromptAnalysisSuggestionCard({
  suggestion,
  isAccepted,
  isDismissed,
  onAccept,
  onDismiss,
  isApplying,
}: Props) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  if (isDismissed) return null;

  const confidencePercent = Math.round(suggestion.confidence * 100);

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-colors ${
        isAccepted
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/50 bg-card"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {SECTION_LABELS[suggestion.section] ?? suggestion.section}
          </Badge>
          <Badge
            variant="secondary"
            className={`text-xs ${
              suggestion.type === "add"
                ? "bg-blue-500/10 text-blue-400"
                : suggestion.type === "remove"
                  ? "bg-red-500/10 text-red-400"
                  : "bg-amber-500/10 text-amber-400"
            }`}
          >
            {TYPE_LABELS[suggestion.type] ?? suggestion.type}
          </Badge>
          {isAccepted && (
            <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
              Aplicada
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {confidencePercent}%
        </span>
      </div>

      {/* Reason */}
      <p className="text-sm text-muted-foreground">{suggestion.reason}</p>

      {/* Diff */}
      {suggestion.current_text && suggestion.type !== "add" && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs font-medium text-red-400 mb-1">Atual</p>
          <p className="text-sm whitespace-pre-wrap">{suggestion.current_text}</p>
        </div>
      )}
      {suggestion.suggested_text && suggestion.type !== "remove" && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-400 mb-1">Sugerido</p>
          <p className="text-sm whitespace-pre-wrap">{suggestion.suggested_text}</p>
        </div>
      )}

      {/* Evidence */}
      {suggestion.evidence.length > 0 && (
        <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <MessageSquare className="w-3 h-3" />
            Ver evidências ({suggestion.evidence.length} conversa{suggestion.evidence.length > 1 ? "s" : ""})
            <ChevronDown
              className={`w-3 h-3 transition-transform ${evidenceOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {suggestion.evidence.map((e, i) => (
              <p
                key={i}
                className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5"
              >
                {e}
              </p>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Actions */}
      {!isAccepted && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="text-muted-foreground"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Ignorar
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            disabled={isApplying}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            {isApplying ? "Aplicando..." : "Aplicar"}
          </Button>
        </div>
      )}
    </div>
  );
}
