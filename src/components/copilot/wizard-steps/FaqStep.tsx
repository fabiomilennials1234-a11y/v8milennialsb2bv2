/**
 * Step: Perguntas Frequentes
 *
 * Array de FAQs (pergunta + resposta) para o agente usar como base.
 * Quando o template tem faqSeeds, pré-popula com as perguntas (resposta vazia).
 * Botão "Gerar com IA" usa o businessContext preenchido para sugerir FAQs relevantes.
 */

import { useEffect, useRef, useState } from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { CopilotWizardData, AgentTemplateType } from "@/types/copilot";
import { getTemplatePromptConfig } from "@/lib/copilot/template-prompts";

export function FaqStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "faqs",
  });

  const templateType = watch("templateType") as AgentTemplateType;
  const businessContext = watch("businessContext");
  const seededRef = useRef(false);

  const [showAIDialog, setShowAIDialog] = useState(false);
  const [faqCount, setFaqCount] = useState(6);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Pré-popular com faqSeeds do template quando o campo está vazio
  useEffect(() => {
    if (seededRef.current || fields.length > 0) return;

    const config = getTemplatePromptConfig(templateType);
    if (config?.faqSeeds && config.faqSeeds.length > 0) {
      config.faqSeeds.forEach((seed) => {
        append({ question: seed.question, answer: "" });
      });
      seededRef.current = true;
    }
  }, [templateType, fields.length, append]);

  const handleAddFaq = () => {
    if (fields.length < 20) {
      append({ question: "", answer: "" });
    }
  };

  const openAIDialog = () => {
    if (!businessContext?.companyName || businessContext.companyName.trim().length < 2) {
      toast.error("Preencha o Contexto do Negócio antes de gerar FAQs com IA", {
        description: "O nome da empresa é necessário para gerar perguntas relevantes.",
      });
      return;
    }
    setReplaceExisting(fields.length === 0 || true);
    setShowAIDialog(true);
  };

  const handleGenerateFAQs = async () => {
    setIsGenerating(true);
    setShowAIDialog(false);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-faqs`,
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
              primaryCta: businessContext.primaryCta,
            },
            templateType: templateType || "sdr",
            count: faqCount,
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

      const generated = result?.faqs as Array<{ question: string; answer: string }> | undefined;
      if (!generated || generated.length === 0) throw new Error("Nenhuma FAQ gerada");

      if (replaceExisting) {
        replace(generated);
      } else {
        generated.forEach((faq) => append(faq));
      }

      toast.success(`${generated.length} FAQs geradas com IA! Revise e ajuste as respostas.`);
    } catch (err: any) {
      console.error("[FaqStep] Erro ao gerar FAQs:", err);
      toast.error("Erro ao gerar FAQs", {
        description: err?.message || "Tente novamente em alguns segundos.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const hasBusinessContext = businessContext?.companyName?.trim().length >= 2;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-2">Perguntas Frequentes</h2>
          <p className="text-muted-foreground">
            Configure respostas padrão para perguntas comuns (opcional)
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 flex-shrink-0"
          onClick={openAIDialog}
          disabled={isGenerating || !hasBusinessContext}
          title={!hasBusinessContext ? "Preencha o Contexto do Negócio primeiro" : undefined}
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
              Gerar FAQs com IA
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              A IA usará o contexto do negócio já preenchido para gerar perguntas e respostas relevantes para{" "}
              <strong>{businessContext?.companyName}</strong>.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">Quantidade de FAQs</label>
              <div className="flex gap-2">
                {[4, 6, 8, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFaqCount(n)}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      faqCount === n
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
                  id="replace-existing"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="replace-existing" className="text-sm cursor-pointer">
                  Substituir as {fields.length} FAQ{fields.length > 1 ? "s" : ""} existentes
                  <span className="block text-xs text-muted-foreground">
                    Desmarcado = adicionar às existentes
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
                onClick={handleGenerateFAQs}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Gerar {faqCount} FAQs
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        {fields.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">
              Nenhuma FAQ adicionada ainda
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleAddFaq}
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar manualmente
              </Button>
              {hasBusinessContext && (
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
            {fields.map((field, index) => {
              const config = getTemplatePromptConfig(templateType);
              const seed = config?.faqSeeds?.[index];
              const answerPlaceholder = seed?.hint || "Ex: O prazo padrão é de 5 dias úteis após confirmação...";

              return (
                <Card key={field.id} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-sm text-muted-foreground">FAQ {index + 1}</h3>
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
                              placeholder={answerPlaceholder}
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
              );
            })}

            {fields.length < 20 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAddFaq}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar outra FAQ
              </Button>
            )}
          </>
        )}
      </div>

      {fields.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Máximo de 20 FAQs. O agente usará essas respostas como base, mas adaptará ao contexto específico.
        </p>
      )}
    </div>
  );
}
