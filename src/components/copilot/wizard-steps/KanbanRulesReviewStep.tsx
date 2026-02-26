/**
 * Step: Revisão de Kanban Rules
 *
 * Exibe as regras de kanban pré-populadas da config do template
 * e permite ao usuário revisar/editar goal e behavior de cada etapa.
 * Etapas podem ser desabilitadas (toggle) sem serem removidas.
 */

import { useFormContext, useFieldArray } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { KanbanSquare } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

const PIPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  confirmacao: "Confirmação",
  propostas: "Propostas",
};

export function KanbanRulesReviewStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const { fields, update } = useFieldArray({
    control,
    name: "kanbanRules",
  });

  if (fields.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <KanbanSquare className="w-6 h-6 text-primary" />
            Regras do Kanban
          </h2>
          <p className="text-muted-foreground">
            Nenhuma regra de kanban configurada para este template.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <KanbanSquare className="w-6 h-6 text-primary" />
          Regras do Kanban
        </h2>
        <p className="text-muted-foreground">
          Revise como o agente deve agir em cada etapa do funil. Desative as etapas que não se aplicam ao seu processo.
        </p>
      </div>

      <div className="space-y-4">
        {fields.map((field, index) => {
          const rule = watch(`kanbanRules.${index}`);
          const isDisabled = (rule as any)?._disabled === true;

          return (
            <Card
              key={field.id}
              className={`p-4 transition-opacity ${isDisabled ? "opacity-50" : ""}`}
            >
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {PIPE_LABELS[(rule as any)?.pipeType] || (rule as any)?.pipeType || "whatsapp"}
                  </Badge>
                  <span className="font-semibold capitalize">
                    {String((rule as any)?.stageName || "").replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {isDisabled ? "Inativo" : "Ativo"}
                  </span>
                  <Switch
                    checked={!isDisabled}
                    onCheckedChange={(checked) => {
                      update(index, { ...(rule as any), _disabled: !checked });
                    }}
                  />
                </div>
              </div>

              {!isDisabled && (
                <div className="space-y-3">
                  <FormField
                    control={control}
                    name={`kanbanRules.${index}.goal` as any}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Objetivo da etapa
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder="O que o agente deve alcançar nesta etapa?"
                            {...f}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name={`kanbanRules.${index}.behavior` as any}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Comportamento esperado
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder="Como o agente deve se comportar aqui?"
                            {...f}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
