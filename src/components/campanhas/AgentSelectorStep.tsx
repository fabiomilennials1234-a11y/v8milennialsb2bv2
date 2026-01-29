import { useCopilotAgents } from "@/hooks/useCopilotAgents";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, Check, AlertCircle, Clock, MessageSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutoConfig } from "@/hooks/useCampanhas";

interface AgentSelectorStepProps {
  selectedAgentId: string | null;
  onAgentSelect: (agentId: string | null) => void;
  autoConfig: AutoConfig;
  onAutoConfigChange: (config: AutoConfig) => void;
}

export function AgentSelectorStep({
  selectedAgentId,
  onAgentSelect,
  autoConfig,
  onAutoConfigChange,
}: AgentSelectorStepProps) {
  const { data: agents, isLoading } = useCopilotAgents();

  // Filtrar apenas agentes que podem ser usados para outbound (outbound ou hybrid)
  const outboundAgents = agents?.filter(
    (agent) =>
      agent.is_active &&
      (agent.operation_mode === "outbound" || agent.operation_mode === "hybrid")
  );

  const selectedAgent = agents?.find((a) => a.id === selectedAgentId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Agent Selection */}
      <div className="space-y-3">
        <Label className="text-base font-semibold flex items-center gap-2">
          <Bot className="w-4 h-4" />
          Selecione o Agente Copilot
        </Label>
        <p className="text-sm text-muted-foreground">
          O agente selecionado enviará mensagens automaticamente e conversará com os leads até atingir o objetivo.
        </p>

        {!outboundAgents?.length ? (
          <Card className="border-dashed border-amber-500/50 bg-amber-500/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-600">Nenhum agente disponível</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Você precisa criar um agente Copilot no modo <strong>Outbound</strong> ou <strong>Híbrido</strong>{" "}
                  e vinculá-lo a uma instância de WhatsApp antes de criar uma campanha automática.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {outboundAgents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              const hasWhatsApp = !!agent.whatsapp_instance_id;

              return (
                <Card
                  key={agent.id}
                  className={cn(
                    "cursor-pointer transition-all hover:border-primary/50",
                    isSelected && "border-primary ring-2 ring-primary/20",
                    !hasWhatsApp && "opacity-60"
                  )}
                  onClick={() => hasWhatsApp && onAgentSelect(agent.id)}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}
                    >
                      <Bot className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{agent.name}</span>
                        <Badge variant={agent.operation_mode === "hybrid" ? "default" : "secondary"} className="text-xs">
                          {agent.operation_mode === "hybrid" ? "Híbrido" : "Outbound"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {hasWhatsApp ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <Check className="w-3 h-3" />
                            WhatsApp vinculado
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600">
                            <AlertCircle className="w-3 h-3" />
                            Sem WhatsApp
                          </span>
                        )}
                        {agent.objective && (
                          <span className="truncate max-w-[200px]" title={agent.objective}>
                            {agent.objective}
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <Check className="w-5 h-5 text-primary shrink-0" />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Auto Config - Only show when agent is selected */}
      {selectedAgent && (
        <div className="space-y-4 pt-4 border-t">
          <Label className="text-base font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Configurações de Disparo
          </Label>

          {/* Delay */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="delay">Delay antes do envio (minutos)</Label>
              <p className="text-xs text-muted-foreground">
                Tempo de espera após adicionar lead na campanha
              </p>
            </div>
            <Input
              id="delay"
              type="number"
              min={0}
              max={60}
              value={autoConfig.delay_minutes ?? 5}
              onChange={(e) =>
                onAutoConfigChange({
                  ...autoConfig,
                  delay_minutes: Number(e.target.value),
                })
              }
              className="w-20"
            />
          </div>

          {/* Send on add lead */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sendOnAdd" className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Disparar ao adicionar lead
              </Label>
              <p className="text-xs text-muted-foreground">
                Enviar mensagem automaticamente quando um lead entrar na campanha
              </p>
            </div>
            <Switch
              id="sendOnAdd"
              checked={autoConfig.send_on_add_lead !== false}
              onCheckedChange={(checked) =>
                onAutoConfigChange({
                  ...autoConfig,
                  send_on_add_lead: checked,
                })
              }
            />
          </div>

          {/* Working hours */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="workingHours" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Apenas horário comercial
              </Label>
              <p className="text-xs text-muted-foreground">
                Disparar apenas durante o horário configurado
              </p>
            </div>
            <Switch
              id="workingHours"
              checked={autoConfig.working_hours_only ?? false}
              onCheckedChange={(checked) =>
                onAutoConfigChange({
                  ...autoConfig,
                  working_hours_only: checked,
                })
              }
            />
          </div>

          {/* Working hours range */}
          {autoConfig.working_hours_only && (
            <div className="ml-6 p-3 bg-muted/50 rounded-lg space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label htmlFor="startHour">Início</Label>
                  <Input
                    id="startHour"
                    type="time"
                    value={autoConfig.working_hours?.start ?? "09:00"}
                    onChange={(e) =>
                      onAutoConfigChange({
                        ...autoConfig,
                        working_hours: {
                          start: e.target.value,
                          end: autoConfig.working_hours?.end ?? "18:00",
                        },
                      })
                    }
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="endHour">Fim</Label>
                  <Input
                    id="endHour"
                    type="time"
                    value={autoConfig.working_hours?.end ?? "18:00"}
                    onChange={(e) =>
                      onAutoConfigChange({
                        ...autoConfig,
                        working_hours: {
                          start: autoConfig.working_hours?.start ?? "09:00",
                          end: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
