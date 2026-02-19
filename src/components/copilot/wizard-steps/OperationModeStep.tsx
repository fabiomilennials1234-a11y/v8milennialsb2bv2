/**
 * Step 14: Modo de Operação
 *
 * Define se o agente é Inbound (espera lead), Outbound (inicia conversa) ou Híbrido.
 */

import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PhoneIncoming, PhoneOutgoing, ArrowLeftRight } from "lucide-react";
import { motion } from "framer-motion";
import type { CopilotWizardData } from "@/types/copilot";

const OPERATION_MODES = [
  {
    value: "inbound",
    label: "Inbound",
    description: "Agente espera o lead mandar mensagem primeiro. Ideal para atendimento reativo.",
    icon: PhoneIncoming,
    color: "text-blue-500",
  },
  {
    value: "outbound",
    label: "Outbound (BDR)",
    description: "Agente inicia a conversa automaticamente quando um lead entra. Ideal para campanhas e prospecção ativa.",
    icon: PhoneOutgoing,
    color: "text-green-500",
  },
  {
    value: "hybrid",
    label: "Híbrido",
    description: "Agente pode iniciar conversas E responder quando acionado. Flexibilidade máxima.",
    icon: ArrowLeftRight,
    color: "text-purple-500",
  },
];

export function OperationModeStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const selectedMode = watch("operationMode");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <PhoneOutgoing className="w-6 h-6 text-primary" />
          Modo de Operação
        </h2>
        <p className="text-muted-foreground">
          Defina como seu agente BDR vai atuar: esperando leads ou indo atrás deles.
        </p>
      </div>

      <FormField
        control={control}
        name="operationMode"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <RadioGroup
                onValueChange={field.onChange}
                defaultValue={field.value}
                className="grid gap-4"
              >
                {OPERATION_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isSelected = selectedMode === mode.value;
                  
                  return (
                    <motion.label
                      key={mode.value}
                      className={`flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-muted hover:border-primary/50"
                      }`}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <RadioGroupItem value={mode.value} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-5 h-5 ${mode.color}`} />
                          <span className="font-semibold">{mode.label}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {mode.description}
                        </p>
                      </div>
                    </motion.label>
                  );
                })}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {selectedMode === "outbound" || selectedMode === "hybrid" ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/30 rounded-lg p-4"
        >
          <h4 className="font-semibold text-green-400 mb-2">
            ✨ Modo Outbound Ativado
          </h4>
          <p className="text-sm text-muted-foreground">
            Nos próximos passos, você vai configurar:
          </p>
          <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
            <li><strong>Gatilhos de ativação</strong> - Quais condições ativam o agente</li>
            <li><strong>Primeira mensagem</strong> - Template personalizado do primeiro contato</li>
            <li><strong>Ações automáticas</strong> - O que fazer quando qualificar/desqualificar</li>
          </ul>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4"
        >
          <h4 className="font-semibold text-blue-400 mb-2">
            📥 Modo Inbound
          </h4>
          <p className="text-sm text-muted-foreground">
            O agente vai responder quando leads mandarem mensagem pelo WhatsApp.
            Os próximos passos de configuração de outbound serão pulados.
          </p>
        </motion.div>
      )}
    </div>
  );
}
