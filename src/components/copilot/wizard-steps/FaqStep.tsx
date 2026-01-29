/**
 * Step 7: Perguntas Frequentes
 *
 * Array de FAQs (pergunta + resposta) para o agente usar como base.
 */

import { useFormContext, useFieldArray } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

export function FaqStep() {
  const { control } = useFormContext<CopilotWizardData>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "faqs",
  });

  const handleAddFaq = () => {
    if (fields.length < 20) {
      append({ question: "", answer: "" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Perguntas Frequentes</h2>
        <p className="text-muted-foreground">
          Configure respostas padrão para perguntas comuns (opcional)
        </p>
      </div>

      <div className="space-y-4">
        {fields.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">
              Nenhuma FAQ adicionada ainda
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={handleAddFaq}
            >
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Primeira FAQ
            </Button>
          </div>
        ) : (
          <>
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold">FAQ {index + 1}</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>

                <div className="space-y-3">
                  <FormField
                    control={control}
                    name={`faqs.${index}.question`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pergunta</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex: Qual o prazo de entrega?"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name={`faqs.${index}.answer`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Resposta</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Ex: O prazo padrão é de 5 dias úteis após confirmação..."
                            {...field}
                            rows={3}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>
            ))}

            {fields.length < 20 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAddFaq}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Outra FAQ
              </Button>
            )}
          </>
        )}
      </div>

      {fields.length > 0 && (
        <FormDescription>
          Máximo de 20 FAQs. O agente usará essas respostas como base, mas
          adaptará ao contexto específico.
        </FormDescription>
      )}
    </div>
  );
}
