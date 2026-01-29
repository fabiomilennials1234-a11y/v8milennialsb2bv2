/**
 * Step 8: Objetivo Principal
 *
 * Define o objetivo final do agente e regras por etapa do Kanban (opcional).
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
import { Textarea } from "@/components/ui/textarea";
import type { CopilotWizardData } from "@/types/copilot";
import { Target } from "lucide-react";

export function ObjectiveStep() {
  const { control } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Target className="w-6 h-6 text-millennials-yellow" />
          Objetivo Principal
        </h2>
        <p className="text-muted-foreground">
          Defina o objetivo final de cada conversa com este agente
        </p>
      </div>

      <FormField
        control={control}
        name="mainObjective"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Objetivo Final</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Ex: Qualificar leads através de perguntas estratégicas para identificar fit, budget, autoridade, necessidade e timeline (BANT), garantindo que apenas leads qualificados avancem no funil."
                {...field}
                rows={6}
                className="resize-none"
              />
            </FormControl>
            <FormDescription>
              Descreva de forma clara e concisa o que o agente deve alcançar em
              cada interação (10-500 caracteres)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="bg-muted/50 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">📋 Exemplos de Objetivos:</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="font-medium">Qualificador:</span> "Identificar fit
            e urgência do lead através de perguntas BANT, decidindo se pode
            avançar no funil."
          </li>
          <li>
            <span className="font-medium">SDR:</span> "Agendar reuniões
            qualificadas com decisores, superando objeções iniciais."
          </li>
          <li>
            <span className="font-medium">Follow-up:</span> "Reengajar leads
            inativos identificando o momento ideal para reativação."
          </li>
        </ul>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
        <h3 className="font-semibold text-sm mb-2">ℹ️ Sobre Regras do Kanban</h3>
        <p className="text-sm text-muted-foreground">
          As regras específicas por etapa do Kanban serão configuradas
          posteriormente. Por enquanto, foque no objetivo geral do agente.
        </p>
      </div>
    </div>
  );
}
