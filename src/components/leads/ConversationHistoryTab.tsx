import { useState } from "react";
import {
  Bot,
  MessageSquare,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useConversationSummary,
  useGenerateSummary,
} from "@/hooks/useConversationHistory";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { EmbeddedChatWindow } from "@/components/chat/EmbeddedChatWindow";

interface ConversationHistoryTabProps {
  leadId: string;
  leadName?: string;
  /** Lead phone number — required for embedded chat */
  leadPhone?: string | null;
}

const stateLabels: Record<string, string> = {
  NEW_LEAD: "Novo Lead",
  QUALIFYING: "Qualificando",
  QUALIFIED: "Qualificado",
  SCHEDULING: "Agendando",
  SCHEDULED: "Agendado",
  FOLLOW_UP: "Follow-up",
  WAITING_HUMAN: "Aguardando Humano",
  CLOSED_WON: "Ganho",
  CLOSED_LOST: "Perdido",
};

const sentimentLabels: Record<string, { label: string; color: string }> = {
  positive: { label: "Positivo", color: "bg-success/10 text-success" },
  neutral: { label: "Neutro", color: "bg-muted text-muted-foreground" },
  negative: { label: "Negativo", color: "bg-destructive/10 text-destructive" },
};

const temperatureLabels: Record<string, { label: string; color: string; icon: string }> = {
  hot: { label: "Quente", color: "text-red-500", icon: "🔥" },
  warm: { label: "Morno", color: "text-orange-500", icon: "☀️" },
  cold: { label: "Frio", color: "text-blue-500", icon: "❄️" },
};

export function ConversationHistoryTab({ leadId, leadName, leadPhone }: ConversationHistoryTabProps) {
  const { toast } = useToast();
  const { data: summary, isLoading: summaryLoading } = useConversationSummary(leadId);
  const generateSummary = useGenerateSummary();
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const handleGenerateSummary = () => {
    generateSummary.mutate(
      { leadId, forceRegenerate: true },
      {
        onSuccess: () => {
          toast({
            title: "Resumo gerado",
            description: "O resumo da conversa foi atualizado com sucesso.",
          });
          setSummaryExpanded(true);
        },
        onError: (error) => {
          toast({
            title: "Erro ao gerar resumo",
            description: error instanceof Error ? error.message : "Tente novamente.",
            variant: "destructive",
          });
        },
      }
    );
  };

  // If no phone, show fallback — can't open chat without a phone number
  if (!leadPhone) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Bot className="w-16 h-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium mb-2">Sem telefone cadastrado</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Para visualizar a conversa e enviar mensagens, cadastre um telefone na aba Dados.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Summary bar — collapsible */}
      <div className="shrink-0 border-b border-border/40">
        {/* Summary toggle header */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSummaryExpanded(!summaryExpanded)}
          >
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Resumo IA
            {summary && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {sentimentLabels[summary.sentiment]?.label || "—"}
              </Badge>
            )}
            {summaryExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleGenerateSummary}
            disabled={generateSummary.isPending}
          >
            {generateSummary.isPending ? (
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3 mr-1.5" />
            )}
            {summary ? "Atualizar" : "Gerar Resumo"}
          </Button>
        </div>

        {/* Expanded summary content */}
        {summaryExpanded && (
          <div className="px-4 pb-3 space-y-3 max-h-[280px] overflow-y-auto">
            {summaryLoading ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : summary ? (
              <>
                {/* Summary card */}
                <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        Resumo da Conversa
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {summary.sentiment && (
                          <Badge variant="outline" className={cn("text-[10px]", sentimentLabels[summary.sentiment]?.color)}>
                            {sentimentLabels[summary.sentiment]?.label}
                          </Badge>
                        )}
                        {summary.lead_temperature && (
                          <span className={cn("text-xs font-medium", temperatureLabels[summary.lead_temperature]?.color)}>
                            {temperatureLabels[summary.lead_temperature]?.icon} {temperatureLabels[summary.lead_temperature]?.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4 pb-3">
                    <p className="text-sm">{summary.summary}</p>

                    {summary.key_points && summary.key_points.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                          Pontos-chave
                        </h4>
                        <ul className="space-y-1">
                          {summary.key_points.map((point, i) => (
                            <li key={i} className="text-xs flex items-start gap-1.5">
                              <ArrowRight className="w-2.5 h-2.5 mt-0.5 text-primary shrink-0" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {summary.objections && summary.objections.length > 0 && (
                        <div className="p-2 bg-destructive/5 rounded-lg">
                          <h4 className="text-[10px] font-semibold text-destructive mb-1 flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" />
                            Objeções
                          </h4>
                          <ul className="space-y-0.5">
                            {summary.objections.map((obj, i) => (
                              <li key={i} className="text-[11px] text-muted-foreground">• {obj}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {summary.questions_asked && summary.questions_asked.length > 0 && (
                        <div className="p-2 bg-blue-500/5 rounded-lg">
                          <h4 className="text-[10px] font-semibold text-blue-500 mb-1 flex items-center gap-1">
                            <HelpCircle className="w-2.5 h-2.5" />
                            Perguntas do Lead
                          </h4>
                          <ul className="space-y-0.5">
                            {summary.questions_asked.map((q, i) => (
                              <li key={i} className="text-[11px] text-muted-foreground">• {q}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {summary.next_action && (
                      <div className="p-2 bg-primary/5 rounded-lg border border-primary/20">
                        <h4 className="text-[10px] font-semibold text-primary mb-0.5">Próxima Ação Sugerida</h4>
                        <p className="text-xs">{summary.next_action}</p>
                      </div>
                    )}

                    <p className="text-[10px] text-muted-foreground">
                      Atualizado {formatDistanceToNow(new Date(summary.updated_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-6">
                  <Sparkles className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground mb-3 text-center">
                    Gere um resumo inteligente desta conversa
                  </p>
                  <Button size="sm" onClick={handleGenerateSummary} disabled={generateSummary.isPending}>
                    {generateSummary.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Gerar Resumo com IA
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Embedded WhatsApp chat — takes remaining space */}
      <div className="flex-1 min-h-0">
        <EmbeddedChatWindow
          leadId={leadId}
          leadPhone={leadPhone}
          leadName={leadName}
        />
      </div>
    </div>
  );
}
