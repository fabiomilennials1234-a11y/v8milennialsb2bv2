/**
 * Step: Capacidades do Agente
 *
 * Cards clicáveis para cada permissão booleana (can_*)
 * + campos numéricos para max_conversation_turns e response_delay_ms.
 * Defaults são definidos por template nos configs.
 */

import { useFormContext } from "react-hook-form";
import {
  UserCheck,
  Calendar,
  MessageSquare,
  ArrowRightLeft,
  UserPlus,
  Headphones,
  HelpCircle,
  Database,
  Shield,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { motion } from "framer-motion";
import type { CopilotWizardData } from "@/types/copilot";

const CAPABILITIES = [
  {
    key: "canQualifyLead" as const,
    label: "Qualificar Leads",
    description: "Pode marcar leads como qualificados ou desqualificados",
    icon: UserCheck,
    color: "text-green-500",
    bgActive: "bg-green-500/10 border-green-500/60",
  },
  {
    key: "canScheduleMeeting" as const,
    label: "Agendar Reuniões",
    description: "Pode agendar e confirmar reuniões com leads",
    icon: Calendar,
    color: "text-blue-500",
    bgActive: "bg-blue-500/10 border-blue-500/60",
  },
  {
    key: "canSendFollowup" as const,
    label: "Enviar Follow-ups",
    description: "Pode enviar mensagens de acompanhamento",
    icon: MessageSquare,
    color: "text-purple-500",
    bgActive: "bg-purple-500/10 border-purple-500/60",
  },
  {
    key: "canMoveCards" as const,
    label: "Mover Cards",
    description: "Pode mover leads entre etapas e funis",
    icon: ArrowRightLeft,
    color: "text-orange-500",
    bgActive: "bg-orange-500/10 border-orange-500/60",
  },
  {
    key: "canCreateLead" as const,
    label: "Criar Leads",
    description: "Pode criar novos leads automaticamente",
    icon: UserPlus,
    color: "text-cyan-500",
    bgActive: "bg-cyan-500/10 border-cyan-500/60",
  },
  {
    key: "canTransferHuman" as const,
    label: "Transferir p/ Humano",
    description: "Pode encaminhar conversa para atendente",
    icon: Headphones,
    color: "text-yellow-500",
    bgActive: "bg-yellow-500/10 border-yellow-500/60",
  },
  {
    key: "canAnswerFaq" as const,
    label: "Responder FAQs",
    description: "Pode usar base de perguntas frequentes",
    icon: HelpCircle,
    color: "text-indigo-500",
    bgActive: "bg-indigo-500/10 border-indigo-500/60",
  },
  {
    key: "canUpdateCrm" as const,
    label: "Atualizar CRM",
    description: "Pode atualizar dados em CRM externo",
    icon: Database,
    color: "text-red-500",
    bgActive: "bg-red-500/10 border-red-500/60",
  },
] as const;

type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

export function AgentCapabilitiesStep() {
  const { setValue, watch } = useFormContext<CopilotWizardData>();

  const maxTurns = watch("maxConversationTurns") ?? 20;
  const delayMs = watch("responseDelayMs") ?? 1000;

  const toggleCapability = (key: CapabilityKey) => {
    const current = watch(key);
    setValue(key, !current, { shouldDirty: true });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Shield className="w-6 h-6 text-millennials-yellow" />
          Capacidades do Agente
        </h2>
        <p className="text-muted-foreground">
          Defina o que o agente pode fazer. Clique nos cards para ativar ou
          desativar cada capacidade.
        </p>
      </div>

      {/* Cards de permissões */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CAPABILITIES.map((cap) => {
          const Icon = cap.icon;
          const isActive = watch(cap.key) === true;

          return (
            <motion.button
              key={cap.key}
              type="button"
              onClick={() => toggleCapability(cap.key)}
              className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all ${
                isActive
                  ? cap.bgActive
                  : "border-muted bg-muted/20 opacity-60"
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div
                className={`mt-0.5 p-2 rounded-md ${
                  isActive ? "bg-background/50" : "bg-muted/50"
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${isActive ? cap.color : "text-muted-foreground"}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{cap.label}</span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      isActive
                        ? "bg-green-500/20 text-green-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isActive ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {cap.description}
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Configurações avançadas */}
      <div className="space-y-6 border-t pt-6">
        <h3 className="text-lg font-semibold">Configurações Avançadas</h3>

        {/* Max conversation turns */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Máximo de turnos por conversa</Label>
            <span className="text-sm font-mono text-muted-foreground">
              {maxTurns} turnos
            </span>
          </div>
          <Slider
            value={[maxTurns]}
            onValueChange={([v]) =>
              setValue("maxConversationTurns", v, { shouldDirty: true })
            }
            min={5}
            max={50}
            step={1}
          />
          <p className="text-xs text-muted-foreground">
            Limita o número de mensagens do agente numa conversa para evitar
            loops. Após atingir o limite, transfere para humano.
          </p>
        </div>

        {/* Response delay */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Delay antes de responder</Label>
            <span className="text-sm font-mono text-muted-foreground">
              {(delayMs / 1000).toFixed(1)}s
            </span>
          </div>
          <Slider
            value={[delayMs]}
            onValueChange={([v]) =>
              setValue("responseDelayMs", v, { shouldDirty: true })
            }
            min={0}
            max={5000}
            step={500}
          />
          <p className="text-xs text-muted-foreground">
            Tempo de espera artificial antes do agente enviar a resposta. Simula
            uma resposta mais humana.
          </p>
        </div>
      </div>
    </div>
  );
}
