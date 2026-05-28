import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  useRunPromptAnalysis,
  usePromptAnalysisHistory,
  useAcceptSuggestion,
  useDismissSuggestion,
  type PromptSuggestion,
} from "@/modules/copilot/hooks/usePromptAnalysis";
import { PromptAnalysisSuggestionCard } from "./PromptAnalysisSuggestionCard";

interface Props {
  agentId: string | undefined;
}

export function PromptAnalysisTab({ agentId }: Props) {
  const [activeSuggestions, setActiveSuggestions] = useState<PromptSuggestion[] | null>(null);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ conversations: number; messages: number } | null>(null);

  const runAnalysis = useRunPromptAnalysis();
  const history = usePromptAnalysisHistory(agentId);
  const acceptMutation = useAcceptSuggestion();
  const dismissMutation = useDismissSuggestion();

  const latestAnalysis = history.data?.[0];
  const acceptedIds = new Set(latestAnalysis?.accepted_ids ?? []);
  const dismissedIds = new Set(latestAnalysis?.dismissed_ids ?? []);

  const currentSuggestions = activeSuggestions ?? latestAnalysis?.suggestions ?? [];
  const currentAnalysisId = activeAnalysisId ?? latestAnalysis?.id ?? null;
  const currentStats = stats ?? (latestAnalysis ? {
    conversations: latestAnalysis.conversation_count,
    messages: latestAnalysis.message_count,
  } : null);

  const visibleSuggestions = currentSuggestions.filter((s) => !dismissedIds.has(s.id));
  const appliedCount = currentSuggestions.filter((s) => acceptedIds.has(s.id)).length;

  const handleAnalyze = async () => {
    if (!agentId) return;
    try {
      const result = await runAnalysis.mutateAsync(agentId);
      setActiveSuggestions(result.suggestions);
      setActiveAnalysisId(result.analysis_id);
      setStats({ conversations: result.conversation_count, messages: result.message_count });

      if (result.suggestions.length === 0) {
        toast.success("Nenhuma sugestão encontrada — o prompt está bem configurado!");
      } else {
        toast.success(`${result.suggestions.length} sugestões encontradas`);
      }
    } catch (err: any) {
      const msg = err.message ?? "";
      if (msg.startsWith("rate_limited:")) {
        const nextAt = new Date(msg.split(":").slice(1).join(":"));
        const hours = Math.ceil((nextAt.getTime() - Date.now()) / 3600_000);
        toast.error(`Limite atingido. Próxima análise disponível em ${hours}h.`);
      } else if (msg.startsWith("insufficient_data:")) {
        const [, min, found] = msg.split(":");
        toast.error(`Conversas insuficientes: ${found} encontradas, mínimo ${min}.`);
      } else {
        toast.error("Erro ao analisar conversas.");
      }
    }
  };

  const handleAccept = (suggestion: PromptSuggestion) => {
    if (!currentAnalysisId || !agentId) return;
    acceptMutation.mutate(
      { analysisId: currentAnalysisId, suggestion, agentId },
      {
        onSuccess: () => {
          toast.success(`Sugestão aplicada na seção ${suggestion.section}`);
        },
        onError: () => {
          toast.error("Erro ao aplicar sugestão.");
        },
      },
    );
  };

  const handleDismiss = (suggestion: PromptSuggestion) => {
    if (!currentAnalysisId || !agentId) return;
    dismissMutation.mutate({
      analysisId: currentAnalysisId,
      suggestionId: suggestion.id,
      agentId,
    });
  };

  if (!agentId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm">Salve o agente primeiro para poder analisar conversas.</p>
      </div>
    );
  }

  if (runAnalysis.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-50" />
        <p className="text-sm font-medium">Analisando conversas...</p>
        <p className="text-xs mt-1">Isso pode levar de 5 a 15 segundos.</p>
      </div>
    );
  }

  if (currentSuggestions.length > 0 && currentAnalysisId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">
              {visibleSuggestions.length} sugestão{visibleSuggestions.length !== 1 ? "es" : ""}
              {appliedCount > 0 && (
                <span className="text-emerald-400 ml-1">
                  — {appliedCount} aplicada{appliedCount !== 1 ? "s" : ""}
                </span>
              )}
            </h3>
            {currentStats && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Baseado em {currentStats.conversations} conversas ({currentStats.messages} mensagens)
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAnalyze}
            disabled={runAnalysis.isPending}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Nova análise
          </Button>
        </div>

        <div className="space-y-3">
          {visibleSuggestions.map((s) => (
            <PromptAnalysisSuggestionCard
              key={s.id}
              suggestion={s}
              isAccepted={acceptedIds.has(s.id)}
              isDismissed={dismissedIds.has(s.id)}
              onAccept={() => handleAccept(s)}
              onDismiss={() => handleDismiss(s)}
              isApplying={acceptMutation.isPending && acceptMutation.variables?.suggestion.id === s.id}
            />
          ))}
        </div>

        {visibleSuggestions.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Todas sugestões foram aplicadas ou ignoradas.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 mb-4">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-sm font-medium mb-1">Análise de conversas</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-6">
        Analise as conversas recentes do copilot para receber sugestões de melhoria no prompt.
        Usa as últimas 50 conversas dos últimos 7 dias.
      </p>
      <Button onClick={handleAnalyze} disabled={runAnalysis.isPending}>
        <Sparkles className="w-4 h-4 mr-2" />
        Analisar conversas
      </Button>

      {latestAnalysis && (
        <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Última análise: {new Date(latestAnalysis.created_at).toLocaleDateString("pt-BR")}
        </p>
      )}
    </div>
  );
}
