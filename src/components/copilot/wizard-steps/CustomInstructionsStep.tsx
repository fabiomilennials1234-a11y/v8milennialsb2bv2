/**
 * Step: Instruções Personalizadas (Do's & Don'ts)
 *
 * Duas abas: O que deve fazer / O que não deve fazer.
 * - Auto-populate: botão que extrai Don'ts dos tópicos proibidos e limites do objetivo.
 * - Preencher com IA: modal onde o usuário descreve o problema, IA gera ambas as seções.
 */

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings2, Sparkles, Wand2, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { CopilotWizardData } from "@/types/copilot";

export function CustomInstructionsStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();

  const dosValue = watch("customInstructions.dos") || "";
  const dontsValue = watch("customInstructions.donts") || "";

  // Modal de IA
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ dos: string; donts: string } | null>(null);

  // Tab ativa
  const [activeTab, setActiveTab] = useState<"dos" | "donts">("dos");

  const watchedData = watch();

  /**
   * Auto-popula Don'ts com base em tópicos proibidos e limites do objetivo.
   */
  const handleAutoPopulate = () => {
    const lines: string[] = [];

    // 1. Limites do objetivo composto
    const objLimits = watchedData.objectiveComposite?.limits?.trim();
    if (objLimits) {
      lines.push(objLimits);
    }

    // 2. Tópicos proibidos
    const forbidden = watchedData.forbiddenTopics || [];
    if (forbidden.length > 0) {
      lines.push(`Nunca discuta sobre: ${forbidden.join(", ")}`);
    }

    // 3. Qualificação obrigatória → não avançar sem esses dados
    const required = watchedData.qualification?.requiredFields || [];
    if (required.length > 0) {
      lines.push(`Nunca avance no funil sem antes coletar: ${required.join(", ")}`);
    }

    if (lines.length === 0) {
      toast.info("Nenhuma restrição encontrada nas etapas anteriores para sugerir.");
      return;
    }

    const existing = dontsValue.trim();
    const newContent = existing
      ? `${existing}\n${lines.join("\n")}`
      : lines.join("\n");

    setValue("customInstructions.donts", newContent, { shouldDirty: true });
    setActiveTab("donts");
    toast.success(`${lines.length} regra(s) adicionada(s) automaticamente`);
  };

  /**
   * Chama a edge function para gerar Do's e Don'ts com base na descrição do usuário.
   */
  const handleGenerateWithAI = async () => {
    if (!aiDescription.trim()) return;
    setIsGenerating(true);
    setAiPreview(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const response = await fetch(`${supabaseUrl}/functions/v1/generate-custom-instructions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          description: aiDescription.trim(),
          templateType: watchedData.templateType || "sdr",
          businessContext: watchedData.businessContext || {},
          existingDos: dosValue,
          existingDonts: dontsValue,
          forbiddenTopics: watchedData.forbiddenTopics || [],
          objectiveLimits: watchedData.objectiveComposite?.limits || "",
        }),
      });

      let result: { dos?: string; donts?: string; error?: string };
      try {
        result = await response.json();
      } catch {
        throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
      }

      if (!response.ok) {
        throw new Error(result?.error || `Erro HTTP ${response.status}`);
      }

      setAiPreview({
        dos: result.dos || "",
        donts: result.donts || "",
      });
    } catch (err: any) {
      toast.error("Erro ao gerar instruções", { description: err?.message });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyAI = () => {
    if (!aiPreview) return;
    if (aiPreview.dos.trim()) {
      setValue("customInstructions.dos", aiPreview.dos, { shouldDirty: true });
    }
    if (aiPreview.donts.trim()) {
      setValue("customInstructions.donts", aiPreview.donts, { shouldDirty: true });
    }
    setShowAIModal(false);
    setAiDescription("");
    setAiPreview(null);
    toast.success("Instruções aplicadas com sucesso");
  };

  const handleOpenModal = () => {
    setAiDescription("");
    setAiPreview(null);
    setShowAIModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-primary" />
            Instruções Personalizadas
          </h2>
          <p className="text-muted-foreground">
            Defina o que o agente deve e não deve fazer nesta operação.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={handleOpenModal}
        >
          <Wand2 className="w-4 h-4" />
          Corrigir com IA
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "dos" | "donts")}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="dos" className="gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            O que deve fazer
            {dosValue.trim().length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                {dosValue.split("\n").filter((l) => l.trim()).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="donts" className="gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            O que não deve fazer
            {dontsValue.trim().length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                {dontsValue.split("\n").filter((l) => l.trim()).length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Aba: Do's */}
        <TabsContent value="dos" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Regras positivas que o agente deve seguir — comportamentos esperados, jargões da empresa, situações especiais.
          </p>
          <FormField
            control={control}
            name="customInstructions.dos"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    placeholder={
                      "Ex:\n- Sempre perguntar o CNPJ antes de qualificar\n- Oferecer 10% de desconto para fechamento no dia\n- Priorizar leads que mencionem urgência\n- Usar o termo 'parceria' ao invés de 'venda'"
                    }
                    rows={9}
                    className="resize-none"
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground text-right mt-1">
                  {(field.value || "").length}/2000 caracteres
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        </TabsContent>

        {/* Aba: Don'ts */}
        <TabsContent value="donts" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Proibições absolutas — o que o agente nunca deve fazer, mencionar ou prometer.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs h-7 shrink-0"
              onClick={handleAutoPopulate}
            >
              <RefreshCw className="w-3 h-3" />
              Importar das outras etapas
            </Button>
          </div>
          <FormField
            control={control}
            name="customInstructions.donts"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    placeholder={
                      "Ex:\n- Nunca mencionar o concorrente X pelo nome\n- Não prometer prazos de entrega sem confirmar com a equipe\n- Nunca enviar valores sem aprovação do comercial\n- Não avançar sem coletar: nome, cargo e CNPJ"
                    }
                    rows={9}
                    className="resize-none"
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground text-right mt-1">
                  {(field.value || "").length}/2000 caracteres
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        </TabsContent>
      </Tabs>

      {/* Modal IA */}
      <Dialog open={showAIModal} onOpenChange={setShowAIModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Corrigir instruções com IA
            </DialogTitle>
            <DialogDescription>
              Descreva o que está errado, o que o agente está fazendo de incorreto, ou o que precisa ser ajustado. A IA vai gerar os Do's e Don'ts adequados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Textarea
              placeholder="Ex: O agente está sendo muito insistente depois do primeiro contato. Também está mencionando o preço antes de qualificar o lead. Preciso que ele seja mais consultivo e nunca fale de valores antes de entender a necessidade."
              rows={5}
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              disabled={isGenerating}
            />

            {!aiPreview && (
              <Button
                type="button"
                className="w-full gap-2"
                onClick={handleGenerateWithAI}
                disabled={!aiDescription.trim() || isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isGenerating ? "Gerando..." : "Gerar instruções"}
              </Button>
            )}

            {/* Preview gerado */}
            {aiPreview && (
              <div className="space-y-3">
                {aiPreview.dos && (
                  <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20 p-3">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      O que deve fazer
                    </p>
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-sans">{aiPreview.dos}</pre>
                  </div>
                )}
                {aiPreview.donts && (
                  <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20 p-3">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" />
                      O que não deve fazer
                    </p>
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-sans">{aiPreview.donts}</pre>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setAiPreview(null);
                    setAiDescription("");
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setShowAIModal(false)}>
              Cancelar
            </Button>
            {aiPreview && (
              <Button type="button" onClick={handleApplyAI} className="gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Aplicar instruções
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
