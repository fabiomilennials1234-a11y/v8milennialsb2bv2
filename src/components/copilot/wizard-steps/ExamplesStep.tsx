/**
 * Step 11: Exemplos de conversa (few-shot)
 *
 * Ajuda a deixar o agente mais humano com exemplos reais.
 * Inclui botão "Gerar com IA" que chama edge function.
 */

import { useState } from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, MessageSquareText, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { CopilotWizardData } from "@/types/copilot";

export function ExamplesStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "examples",
  });
  const [isGenerating, setIsGenerating] = useState(false);

  const businessContext = watch("businessContext");
  const templateType = watch("templateType");
  const personality = watch("personality");

  const canGenerate =
    businessContext?.productSummary &&
    businessContext.productSummary.length >= 20;

  const handleAddExample = () => {
    if (fields.length < 10) {
      append({ lead: "", agent: "" });
    }
  };

  const handleGenerateWithAI = async () => {
    if (!canGenerate) {
      toast.error("Preencha o campo 'Produto/Serviço' no Contexto do Negócio (min. 20 caracteres)");
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-agent-examples",
        {
          body: {
            businessContext: {
              companyName: businessContext.companyName,
              productSummary: businessContext.productSummary,
              idealCustomerProfile: businessContext.idealCustomerProfile,
              valueProps: businessContext.valueProps,
              customerPains: businessContext.customerPains,
            },
            templateType,
            personality,
          },
        }
      );

      if (error) throw error;

      const examples = data?.examples as Array<{ lead: string; agent: string }>;
      if (examples && examples.length > 0) {
        examples.forEach((ex) => {
          if (fields.length < 10) {
            append({ lead: ex.lead, agent: ex.agent });
          }
        });
        toast.success(`${examples.length} exemplos gerados com IA!`);
      } else {
        toast.error("Nenhum exemplo foi gerado. Tente novamente.");
      }
    } catch (error: any) {
      console.error("Erro ao gerar exemplos:", error);
      toast.error("Erro ao gerar exemplos", {
        description: error?.message || "Tente novamente em alguns segundos.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <MessageSquareText className="w-6 h-6 text-millennials-yellow" />
          Exemplos de Conversa
        </h2>
        <p className="text-muted-foreground">
          Adicione exemplos curtos para calibrar o tom do agente.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={handleGenerateWithAI}
        disabled={isGenerating || !canGenerate}
        className="w-full border-dashed"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Gerando exemplos...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            Gerar com IA
          </>
        )}
      </Button>
      {!canGenerate && (
        <p className="text-xs text-muted-foreground text-center -mt-3">
          Preencha o campo "Produto/Serviço" no Contexto do Negócio para habilitar
        </p>
      )}

      <div className="space-y-4">
        {fields.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">
              Nenhum exemplo adicionado ainda
            </p>
            <Button type="button" variant="outline" onClick={handleAddExample}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Primeiro Exemplo
            </Button>
          </div>
        ) : (
          <>
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold">Exemplo {index + 1}</h3>
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
                    name={`examples.${index}.lead`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mensagem do lead</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Ex: Quero saber o preço"
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name={`examples.${index}.agent`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Resposta ideal do agente</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Ex: Consigo te orientar sim! Pra eu te passar algo certo, qual o volume aproximado?"
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>
            ))}

            {fields.length < 10 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAddExample}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Outro Exemplo
              </Button>
            )}
          </>
        )}
      </div>

      {fields.length > 0 && (
        <FormDescription>
          Até 10 exemplos. Priorize conversas reais e curtas.
        </FormDescription>
      )}

      <FormField
        control={control}
        name="examples"
        render={() => (
          <FormItem>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
