import { useCopilotAgent } from "@/hooks/useCopilotAgents";
import { useDispatchLog, useDispatchStats } from "@/hooks/useCampaignTemplates";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bot, MessageSquare, Clock, Check, X, AlertCircle,
  Play, Pause, RefreshCcw, ExternalLink, Send, User
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Campanha } from "@/hooks/useCampanhas";
import { cn } from "@/lib/utils";

interface CampanhaAutomaticaPanelProps {
  campanha: Campanha;
}

export function CampanhaAutomaticaPanel({ campanha }: CampanhaAutomaticaPanelProps) {
  const { data: agent, isLoading: loadingAgent } = useCopilotAgent(campanha.agent_id || undefined);
  const { data: dispatchLog = [] } = useDispatchLog(campanha.id, 100);
  const { data: stats } = useDispatchStats(campanha.id);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-600">Pendente</Badge>;
      case "sent":
        return <Badge variant="outline" className="text-green-600 dark:text-green-400 border-green-300 dark:border-green-600">Enviado</Badge>;
      case "failed":
        return <Badge variant="destructive">Falhou</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelado</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loadingAgent) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Agent Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-12 h-12 rounded-lg flex items-center justify-center",
                agent?.is_active ? "bg-green-100 dark:bg-green-900/40" : "bg-gray-100 dark:bg-muted"
              )}>
                <Bot className={cn(
                  "w-6 h-6",
                  agent?.is_active ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-muted-foreground"
                )} />
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  {agent?.name || "Agente não encontrado"}
                  {agent?.is_active ? (
                    <Badge variant="outline" className="text-green-600 dark:text-green-400 border-green-300 dark:border-green-600">Ativo</Badge>
                  ) : (
                    <Badge variant="secondary">Inativo</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {agent?.objective || "Sem objetivo definido"}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!agent}>
                <ExternalLink className="w-4 h-4 mr-1" />
                Ver Agente
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Auto Config Display */}
        {campanha.auto_config && (
          <CardContent className="pt-0">
            <Separator className="mb-4" />
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div className="text-sm">
                  <span className="text-muted-foreground">Delay: </span>
                  <span className="font-medium">{campanha.auto_config.delay_minutes || 5} min</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-muted-foreground" />
                <div className="text-sm">
                  <span className="text-muted-foreground">Auto-envio: </span>
                  <span className="font-medium">
                    {campanha.auto_config.send_on_add_lead !== false ? "Sim" : "Não"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div className="text-sm">
                  <span className="text-muted-foreground">Horário: </span>
                  <span className="font-medium">
                    {campanha.auto_config.working_hours_only
                      ? `${campanha.auto_config.working_hours?.start || "09:00"} - ${campanha.auto_config.working_hours?.end || "18:00"}`
                      : "24h"
                    }
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.pending || 0}</p>
                <p className="text-xs text-muted-foreground">Pendentes</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.sent || 0}</p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <X className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.failed || 0}</p>
                <p className="text-xs text-muted-foreground">Falharam</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.total || 0}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dispatch Log */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Histórico de Disparos</CardTitle>
            <Button variant="ghost" size="sm">
              <RefreshCcw className="w-4 h-4 mr-1" />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {dispatchLog.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum disparo registrado ainda</p>
              <p className="text-sm">Os disparos aparecerão aqui quando leads forem adicionados à campanha</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {dispatchLog.map((log: any) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {log.lead?.name || "Lead desconhecido"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {log.lead?.company && `${log.lead.company} • `}
                          {log.lead?.phone || "Sem telefone"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {getStatusBadge(log.status)}
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {log.sent_at
                            ? formatDistanceToNow(new Date(log.sent_at), { addSuffix: true, locale: ptBR })
                            : log.scheduled_at
                              ? `Agendado: ${format(new Date(log.scheduled_at), "HH:mm", { locale: ptBR })}`
                              : "Pendente"
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
