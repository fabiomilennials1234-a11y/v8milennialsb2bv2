/**
 * Step: Exemplos de Conversa (few-shot)
 *
 * Seguindo o mesmo estilo do FaqStep:
 * - Estado vazio com opção de adicionar manualmente ou gerar com IA
 * - Dialog pede quantos exemplos gerar antes de chamar a IA
 * - Opção de substituir ou acumular exemplos existentes
 */

import { useState } from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, MessageSquareText, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { CopilotWizardData } from "@/types/copilot";

export function ExamplesStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "examples",
  });

  const [showAIDialog, setShowAIDialog] = useState(false);
  const [exampleCount, setExampleCount] = useState(3);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const businessContext = watch("businessContext");
  const templateType = watch("templateType");
  const personality = watch("personality");

  const canGenerate =
    !!businessContext?.productSummary &&
    businessContext.productSummary.length >= 20;

  const handleAddExample = () => {
    if (fields.length < 10) {
      append({ lead: "", agent: "" });
    }
  };

  const openAIDialog = () => {
    if (!canGenerate) {
      toast.error("Preencha o campo 'Produto/Serviço' no Contexto do Negócio (mín. 20 caracteres)");
      return;
    }
    setReplaceExisting(fields.length === 0 || true);
    setShowAIDialog(true);
  };

  const handleGenerateWithAI = async () => {
    setIsGenerating(true);
    setShowAIDialog(false);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-agent-examples`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
          body: JSON.stringify({
            businessContext: {
              companyName: businessContext.companyName,
              productSummary: businessContext.productSummary,
              idealCustomerProfile: businessContext.idealCustomerProfile,
              valueProps: businessContext.valueProps,
              customerPains: businessContext.customerPains,
            },
            templateType,
            personality,
            count: exampleCount,
          }),
        }
      );

      let result: Record<string, unknown>;
      try {
        result = await response.json();
      } catch {
        throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
      }

      if (!response.ok) {
        const errMsg = (result?.error as string) || `Erro HTTP ${response.status}`;
        throw new Error(errMsg);
      }

      const examples = result?.examples as Array<{ lead: string; agent: string }> | undefined;
      if (!examples || examples.length === 0) throw new Error("Nenhum exemplo foi gerado. Tente novamente.");

      if (replaceExisting) {
        replace(examples.slice(0, 10));
      } else {
        const remaining = 10 - fields.length;
        examples.slice(0, remaining).forEach((ex) => append(ex));
      }

      toast.success(`${Math.min(examples.length, 10)} exemplos gerados com IA! Revise e ajuste.`);
    } catch (err: any) {
      console.error("[ExamplesStep] Erro ao gerar exemplos:", err);
      toast.error("Erro ao gerar exemplos", {
        description: err?.message || "Tente novamente em alguns segundos.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <MessageSquareText className="w-6 h-6 text-primary" />
            Exemplos de Conversa
          </h2>
          <p className="text-muted-foreground">
            Calibre o tom do agente com exemplos reais de mensagem e resposta ideal (opcional).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 flex-shrink-0"
          onClick={openAIDialog}
          disabled={isGenerating || !canGenerate}
          title={!canGenerate ? "Preencha o Contexto do Negócio primeiro" : undefined}
        >
          {isGenerating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {isGenerating ? "Gerando..." : "Gerar com IA"}
        </Button>
      </div>

      {/* Dialog de configuração da geração */}
      <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Gerar Exemplos com IA
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              A IA usará o contexto do negócio para gerar exemplos de conversas realistas para{" "}
              <strong>{businessContext?.companyName || "sua empresa"}</strong>.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">Quantidade de exemplos</label>
              <div className="flex gap-2">
                {[2, 3, 5, 7].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setExampleCount(n)}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      exampleCount === n
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input bg-background hover:bg-muted/50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {fields.length > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <input
                  type="checkbox"
                  id="replace-examples"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="replace-examples" className="text-sm cursor-pointer">
                  Substituir os {fields.length} exemplo{fields.length > 1 ? "s" : ""} existentes
                  <span className="block text-xs text-muted-foreground">
                    Desmarcado = adicionar aos existentes
                  </span>
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAIDialog(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2"
                onClick={handleGenerateWithAI}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Gerar {exampleCount} exemplos
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lista de exemplos */}
      <div className="space-y-4">
        {fields.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">
              Nenhum exemplo adicionado ainda
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleAddExample}
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar manualmente
              </Button>
              {canGenerate && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={openAIDialog}
                  disabled={isGenerating}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Gerar com IA
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-sm text-muted-foreground">
                    Exemplo {index + 1}
                  </h3>
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
                Adicionar outro exemplo
              </Button>
            )}
          </>
        )}
      </div>

      {fields.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Até 10 exemplos. Priorize conversas reais e curtas para melhor calibração.
        </p>
      )}

      {/* Campo oculto para mostrar erros do array */}
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
