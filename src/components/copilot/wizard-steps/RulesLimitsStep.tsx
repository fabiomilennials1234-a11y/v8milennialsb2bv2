/**
 * Step: Regras e Limites (Wizard v3)
 *
 * Substitui: SkillsStep + AllowedTopicsStep + ForbiddenTopicsStep + AgentCapabilitiesStep
 *
 * 2 seções:
 * 1. Habilidades e tópicos — campo livre descritivo
 * 2. Permissões do agente — toggles de capabilities
 */

import { useFormContext } from "react-hook-form";
import { ShieldCheck } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import type { CopilotWizardData } from "@/types/copilot";

const CAPABILITIES = [
  {
    key: "canQualifyLead" as const,
    label: "Qualificar leads",
    description: "Coletar dados e avaliar fit do lead com o ICP",
  },
  {
    key: "canScheduleMeeting" as const,
    label: "Agendar reuniões",
    description: "Propor e confirmar horários para reuniões",
  },
  {
    key: "canSendFollowup" as const,
    label: "Enviar follow-ups",
    description: "Reengajar leads inativos automaticamente",
  },
  {
    key: "canCreateLead" as const,
    label: "Criar leads",
    description: "Criar novos registros de leads no CRM",
  },
  {
    key: "canMoveCards" as const,
    label: "Mover cards no kanban",
    description: "Mover leads entre etapas do funil automaticamente",
  },
  {
    key: "canTransferHuman" as const,
    label: "Transferir para humano",
    description: "Escalar a conversa para um atendente quando necessário",
  },
];

export function RulesLimitsStep() {
  const { register, watch, setValue } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
          Regras e Limites
        </h2>
        <p className="text-muted-foreground">
          Defina o que o agente sabe fazer e quais permissões ele tem no sistema.
        </p>
      </div>

      {/* Habilidades e Tópicos */}
      <div>
        <Label className="text-sm font-medium">
          Habilidades e Tópicos
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          O que o agente sabe fazer e sobre quais assuntos pode conversar?
        </p>
        <Textarea
          {...register("skillsAndTopics")}
          placeholder={`Ex: "Sabe prospectar, qualificar leads usando BANT, agendar reuniões e responder sobre nossos planos e preços. Pode falar sobre nosso produto, o mercado de tecnologia B2B e cases de sucesso. Deve evitar entrar em detalhes técnicos profundos — quando o lead pedir, direcionar para o time técnico."`}
          className="min-h-[140px] resize-y"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Tudo que não estiver aqui, o agente evitará naturalmente.
        </p>
      </div>

      {/* Permissões */}
      <div>
        <Label className="text-sm font-medium mb-3 block">
          Permissões do Agente
        </Label>
        <div className="space-y-3">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.key}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{cap.label}</p>
                <p className="text-xs text-muted-foreground">{cap.description}</p>
              </div>
              <Switch
                checked={watch(cap.key) || false}
                onCheckedChange={(checked) =>
                  setValue(cap.key, checked, { shouldDirty: true })
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* Máximo de turnos */}
      <div>
        <Label className="text-sm font-medium">Máximo de turnos de conversa</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Após este número de trocas, o agente sugere transferir para humano
        </p>
        <Input
          type="number"
          min={5}
          max={50}
          {...register("maxConversationTurns", { valueAsNumber: true })}
          className="w-32"
        />
      </div>
    </div>
  );
}
