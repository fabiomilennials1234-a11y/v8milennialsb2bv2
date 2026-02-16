/**
 * Step: Configuração de Confirmação de Reunião
 *
 * Específico para o tipo Agendador.
 * Configura: ações automáticas de confirmação, lembretes e reagendamento.
 */

import { useFormContext } from "react-hook-form";
import { Calendar, Bell, Clock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CopilotWizardData } from "@/types/copilot";

export function MeetingConfirmationStep() {
  const { setValue, watch } = useFormContext<CopilotWizardData>();
  const automationActions = watch("automationActions");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Calendar className="w-6 h-6 text-millennials-yellow" />
          Confirmação de Reuniões
        </h2>
        <p className="text-muted-foreground">
          Configure como o agente deve gerenciar confirmações e lembretes de reuniões agendadas.
        </p>
      </div>

      {/* Quando lead é qualificado (reunião agendada com sucesso) */}
      <div className="space-y-4 border rounded-lg p-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-millennials-yellow" />
          <h3 className="font-semibold">Quando a reunião é confirmada</h3>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Mover lead para etapa</Label>
            <Select
              value={automationActions?.onQualify?.moveToStage || "agendado"}
              onValueChange={(value) =>
                setValue("automationActions.onQualify.moveToStage", value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agendado">Agendado</SelectItem>
                <SelectItem value="respondeu">Respondeu</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enviar mensagem de confirmação</Label>
              <p className="text-xs text-muted-foreground">
                Envia automaticamente uma mensagem confirmando os detalhes da reunião
              </p>
            </div>
            <Switch
              checked={automationActions?.onQualify?.sendMessage ?? true}
              onCheckedChange={(checked) =>
                setValue("automationActions.onQualify.sendMessage", checked)
              }
            />
          </div>

          {automationActions?.onQualify?.sendMessage && (
            <div className="space-y-2">
              <Label>Template da mensagem de confirmação</Label>
              <Textarea
                value={automationActions?.onQualify?.messageTemplate || ""}
                onChange={(e) =>
                  setValue("automationActions.onQualify.messageTemplate", e.target.value)
                }
                placeholder="Perfeito! Sua reunião está confirmada para {data} às {hora}. Enviaremos um lembrete antes. Até lá!"
                rows={3}
                className="resize-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Quando lead precisa de humano (reagendamento complexo) */}
      <div className="space-y-4 border rounded-lg p-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-orange-400" />
          <h3 className="font-semibold">Quando não consegue agendar / precisa reagendar</h3>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Mover lead para etapa</Label>
            <Select
              value={automationActions?.onNeedHuman?.moveToStage || "aguardando_humano"}
              onValueChange={(value) =>
                setValue("automationActions.onNeedHuman.moveToStage", value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aguardando_humano">Aguardando Humano</SelectItem>
                <SelectItem value="esfriou">Esfriou</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enviar mensagem ao transferir</Label>
              <p className="text-xs text-muted-foreground">
                Mensagem automática quando precisa de intervenção humana
              </p>
            </div>
            <Switch
              checked={automationActions?.onNeedHuman?.sendMessage ?? true}
              onCheckedChange={(checked) =>
                setValue("automationActions.onNeedHuman.sendMessage", checked)
              }
            />
          </div>

          {automationActions?.onNeedHuman?.sendMessage && (
            <div className="space-y-2">
              <Label>Template da mensagem</Label>
              <Textarea
                value={automationActions?.onNeedHuman?.messageTemplate || ""}
                onChange={(e) =>
                  setValue("automationActions.onNeedHuman.messageTemplate", e.target.value)
                }
                placeholder="Entendo! Vou passar para nosso time encontrar o melhor horário para você. Um momento."
                rows={3}
                className="resize-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Dica */}
      <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
        <p>
          <strong>Dica:</strong> O agendador funciona melhor quando configurado com regras
          kanban por etapa (disponível após a criação, na aba "Regras"). Lá você pode definir
          comportamentos específicos para cada fase da confirmação (D-5, D-1, D-0).
        </p>
      </div>
    </div>
  );
}
