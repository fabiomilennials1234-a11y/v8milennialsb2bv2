/**
 * Step: Objetivo Composto (3 partes)
 *
 * Substitui o ObjectiveStep antigo com 3 campos estruturados:
 * - Missão: O que o agente deve fazer
 * - Critério de Sucesso: Quando a interação é considerada bem-sucedida
 * - Limites: O que o agente NÃO deve fazer
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

const PLACEHOLDERS_BY_TEMPLATE: Record<string, { mission: string; success: string; limits: string }> = {
  qualificador: {
    mission: "Qualificar leads através de perguntas estratégicas BANT, identificando fit, budget, autoridade, necessidade e timeline.",
    success: "Lead classificado como qualificado ou desqualificado com dados suficientes para a equipe comercial.",
    limits: "Não tente vender diretamente. Não prometa resultados específicos sem consultar o time.",
  },
  sdr: {
    mission: "Prospectar ativamente e agendar reuniões qualificadas com decisores, superando objeções iniciais.",
    success: "Reunião agendada com decisor que demonstrou interesse genuíno e tem fit mínimo com a solução.",
    limits: "Não faça negociação de preço. Não prometa ROI específico. Não insista mais de 3 vezes sem resposta.",
  },
  followup: {
    mission: "Reengajar leads inativos com abordagens de valor, identificando o momento ideal para reativação.",
    success: "Lead reengajado responde e demonstra interesse em retomar a conversa comercial.",
    limits: "Não envie mais de 3 follow-ups sem resposta. Não pressione leads que recusaram explicitamente.",
  },
  agendador: {
    mission: "Garantir comparecimento em reuniões com confirmações progressivas (D-5 a D-0) e reagendamento ágil.",
    success: "Lead confirma presença ou reunião é reagendada com sucesso dentro de 48h.",
    limits: "Não entre em discussões comerciais. Não qualifique o lead novamente. Não cancele reuniões sem autorização.",
  },
  prospectador: {
    mission: "Abordar novos prospectos com mensagens personalizadas que geram curiosidade e engajamento inicial.",
    success: "Prospecto responde à abordagem e demonstra abertura para uma conversa exploratória.",
    limits: "Não envie mensagens genéricas. Não faça mais de 2 tentativas de contato inicial sem resposta.",
  },
};

export function ObjectiveCompositeStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const templateType = watch("templateType");
  const placeholders = PLACEHOLDERS_BY_TEMPLATE[templateType] || PLACEHOLDERS_BY_TEMPLATE.qualificador;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Target className="w-6 h-6 text-millennials-yellow" />
          Objetivo do Agente
        </h2>
        <p className="text-muted-foreground">
          Defina o objetivo em 3 partes para que o agente saiba exatamente o que fazer, quando teve sucesso e o que evitar.
        </p>
      </div>

      <FormField
        control={control}
        name="objectiveComposite.mission"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Missão *</FormLabel>
            <FormControl>
              <Textarea
                placeholder={placeholders.mission}
                {...field}
                rows={4}
                className="resize-none"
              />
            </FormControl>
            <FormDescription>
              O que o agente deve fazer em cada conversa (min. 20 caracteres)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="objectiveComposite.success_criteria"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Critério de Sucesso *</FormLabel>
            <FormControl>
              <Textarea
                placeholder={placeholders.success}
                {...field}
                rows={3}
                className="resize-none"
              />
            </FormControl>
            <FormDescription>
              Como saber quando a interação foi bem-sucedida (min. 10 caracteres)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="objectiveComposite.limits"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Limites (opcional)</FormLabel>
            <FormControl>
              <Textarea
                placeholder={placeholders.limits}
                {...field}
                rows={3}
                className="resize-none"
              />
            </FormControl>
            <FormDescription>
              O que o agente NÃO deve fazer — restrições e limites de atuação
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
