import { useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  User,
  MessageSquare,
  RefreshCw,
  ThermometerSun,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useFullConversationData,
  useGenerateSummary,
} from "@/hooks/useConversationHistory";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ConversationHistoryTabProps {
  leadId: string;
  leadName?: string;
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

const stateColors: Record<string, string> = {
  NEW_LEAD: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  QUALIFYING: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  QUALIFIED: "bg-green-500/10 text-green-500 border-green-500/20",
  SCHEDULING: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  SCHEDULED: "bg-primary/10 text-primary border-primary/20",
  FOLLOW_UP: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  WAITING_HUMAN: "bg-red-500/10 text-red-500 border-red-500/20",
  CLOSED_WON: "bg-success/10 text-success border-success/20",
  CLOSED_LOST: "bg-muted text-muted-foreground border-muted",
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

export function ConversationHistoryTab({ leadId, leadName }: ConversationHistoryTabProps) {
  const { toast } = useToast();
  const { history, summary, isLoading, refetch } = useFullConversationData(leadId);
  const generateSummary = useGenerateSummary();
  const [showAllMessages, setShowAllMessages] = useState(false);

  const handleGenerateSummary = () => {
    generateSummary.mutate(
      { leadId, forceRegenerate: true },
      {
        onSuccess: () => {
          toast({
            title: "Resumo gerado",
            description: "O resumo da conversa foi atualizado com sucesso.",
          });
          refetch();
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

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const messages = history?.messages || [];
  const conversation = history?.conversation;
  const displayMessages = showAllMessages ? messages : messages.slice(-10);

  // Se não houver mensagens
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Bot className="w-16 h-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium mb-2">Nenhuma conversa encontrada</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Este lead ainda não teve interações com o Copilot. As conversas aparecerão aqui quando houver mensagens.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 pt-4">
      {/* Header com estado da conversa */}
      {conversation && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={stateColors[conversation.state] || stateColors.NEW_LEAD}>
              {stateLabels[conversation.state] || conversation.state}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {messages.length} mensagens
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSummary}
            disabled={generateSummary.isPending}
          >
            {generateSummary.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {summary ? "Atualizar Resumo" : "Gerar Resumo"}
          </Button>
        </div>
      )}

      {/* Card de Resumo */}
      {summary && (
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Resumo da Conversa
              </CardTitle>
              <div className="flex items-center gap-2">
                {summary.sentiment && (
                  <Badge variant="outline" className={sentimentLabels[summary.sentiment]?.color}>
                    {sentimentLabels[summary.sentiment]?.label}
                  </Badge>
                )}
                {summary.lead_temperature && (
                  <span className={cn("text-sm font-medium", temperatureLabels[summary.lead_temperature]?.color)}>
                    {temperatureLabels[summary.lead_temperature]?.icon} {temperatureLabels[summary.lead_temperature]?.label}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Resumo principal */}
            <p className="text-sm">{summary.summary}</p>

            {/* Pontos-chave */}
            {summary.key_points && summary.key_points.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  Pontos-chave
                </h4>
                <ul className="space-y-1">
                  {summary.key_points.map((point, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <ArrowRight className="w-3 h-3 mt-1 text-primary shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Grid de objeções e perguntas */}
            <div className="grid grid-cols-2 gap-4">
              {/* Objeções */}
              {summary.objections && summary.objections.length > 0 && (
                <div className="p-3 bg-destructive/5 rounded-lg">
                  <h4 className="text-xs font-semibold text-destructive mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Objeções
                  </h4>
                  <ul className="space-y-1">
                    {summary.objections.map((obj, i) => (
                      <li key={i} className="text-xs text-muted-foreground">• {obj}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Perguntas */}
              {summary.questions_asked && summary.questions_asked.length > 0 && (
                <div className="p-3 bg-blue-500/5 rounded-lg">
                  <h4 className="text-xs font-semibold text-blue-500 mb-2 flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" />
                    Perguntas do Lead
                  </h4>
                  <ul className="space-y-1">
                    {summary.questions_asked.map((q, i) => (
                      <li key={i} className="text-xs text-muted-foreground">• {q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Próxima ação */}
            {summary.next_action && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <h4 className="text-xs font-semibold text-primary mb-1">Próxima Ação Sugerida</h4>
                <p className="text-sm">{summary.next_action}</p>
              </div>
            )}

            {/* Timestamp */}
            <p className="text-xs text-muted-foreground">
              Atualizado {formatDistanceToNow(new Date(summary.updated_at), { addSuffix: true, locale: ptBR })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Se não tem resumo, mostrar botão para gerar */}
      {!summary && messages.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Sparkles className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground mb-4 text-center">
              Gere um resumo inteligente desta conversa usando IA
            </p>
            <Button onClick={handleGenerateSummary} disabled={generateSummary.isPending}>
              {generateSummary.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Gerar Resumo com IA
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Timeline de Mensagens */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            Histórico de Mensagens
          </h3>
          {messages.length > 10 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllMessages(!showAllMessages)}
            >
              {showAllMessages ? "Ver menos" : `Ver todas (${messages.length})`}
            </Button>
          )}
        </div>

        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {displayMessages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  "flex gap-3",
                  message.role === 'assistant' ? "flex-row" : "flex-row-reverse"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  message.role === 'assistant' 
                    ? "bg-primary/10" 
                    : "bg-muted"
                )}>
                  {message.role === 'assistant' ? (
                    <Bot className="w-4 h-4 text-primary" />
                  ) : (
                    <User className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className={cn(
                  "flex-1 max-w-[80%]",
                  message.role === 'assistant' ? "text-left" : "text-right"
                )}>
                  <div className={cn(
                    "inline-block p-3 rounded-lg text-sm",
                    message.role === 'assistant'
                      ? "bg-primary/5 rounded-tl-none"
                      : "bg-muted rounded-tr-none"
                  )}>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(message.timestamp), "dd/MM HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
