/**
 * Step: Objetivo e Instruções (Wizard v3)
 *
 * Substitui: ObjectiveCompositeStep + CustomInstructionsStep
 *
 * 4 textareas em uma tela:
 * 1. Missão — o que o agente deve fazer
 * 2. O que DEVE fazer — comportamentos e ações obrigatórias
 * 3. O que NÃO deve fazer — restrições e proibições
 * 4. Critérios de sucesso — quando o agente fez um bom trabalho
 */

import { useFormContext } from "react-hook-form";
import { Target } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CopilotWizardData } from "@/types/copilot";

export function ObjectiveInstructionsStep() {
  const { register, formState: { errors } } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Target className="w-6 h-6 text-primary" />
          Objetivo e Instruções
        </h2>
        <p className="text-muted-foreground">
          Defina a missão do agente, o que ele deve e não deve fazer, e como medir sucesso.
        </p>
      </div>

      {/* Missão */}
      <div>
        <Label className="text-sm font-medium">
          Missão <span className="text-red-500">*</span>
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Qual é a missão principal deste agente?
        </p>
        <Textarea
          {...register("objectiveComposite.mission")}
          placeholder="Ex: Qualificar leads inbound via WhatsApp, identificando fit com nosso ICP e agendando reuniões com o time comercial quando houver match."
          className="min-h-[100px] resize-y"
        />
        {errors.objectiveComposite?.mission && (
          <p className="text-xs text-red-500 mt-1">
            {errors.objectiveComposite.mission.message}
          </p>
        )}
      </div>

      {/* O que DEVE fazer */}
      <div>
        <Label className="text-sm font-medium">
          O que DEVE fazer
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Comportamentos, ações e regras que o agente deve seguir
        </p>
        <Textarea
          {...register("customInstructions.dos")}
          placeholder={`Ex:\n- Sempre perguntar o cargo do lead antes de propor reunião\n- Usar técnica SPIN para descobrir dores\n- Enviar link de agendamento após confirmar qualificação\n- Compartilhar cases de sucesso relevantes ao segmento do lead`}
          className="min-h-[120px] resize-y"
        />
      </div>

      {/* O que NÃO deve fazer */}
      <div>
        <Label className="text-sm font-medium">
          O que NÃO deve fazer
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Restrições e comportamentos proibidos (prioridade máxima)
        </p>
        <Textarea
          {...register("customInstructions.donts")}
          placeholder={`Ex:\n- Nunca falar mal de concorrentes\n- Não dar descontos sem aprovação\n- Não inventar funcionalidades que não existem\n- Não prometer prazos de entrega específicos`}
          className="min-h-[120px] resize-y"
        />
      </div>

      {/* Critérios de sucesso */}
      <div>
        <Label className="text-sm font-medium">
          Critérios de sucesso
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Quando o agente fez um bom trabalho? Como medir sucesso?
        </p>
        <Textarea
          {...register("objectiveComposite.success_criteria")}
          placeholder="Ex: O agente teve sucesso quando consegue agendar uma reunião com um decisor qualificado, coletando pelo menos nome, cargo, empresa e dor principal."
          className="min-h-[80px] resize-y"
        />
        {errors.objectiveComposite?.success_criteria && (
          <p className="text-xs text-red-500 mt-1">
            {errors.objectiveComposite.success_criteria.message}
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          <strong className="text-blue-500">Dica:</strong> As instruções de "O que NÃO deve fazer"
          têm prioridade máxima no prompt — o agente seguirá essas restrições acima de qualquer
          outra orientação.
        </p>
      </div>
    </div>
  );
}
