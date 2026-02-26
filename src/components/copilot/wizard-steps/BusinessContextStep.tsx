/**
 * Step: Contexto do Negócio
 *
 * Campos obrigatórios no topo com char counters,
 * opcionais em seção colapsável "Campos avançados".
 * Placeholders variam por templateType.
 *
 * Funcionalidades extras:
 * - "Importar de outro agente": copia businessContext de agente existente
 * - "Preencher com IA": gera campos via edge function a partir de nome + descrição
 */

import { useState } from "react";
import { useFormContext } from "react-hook-form";
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
import { Building2, ChevronDown, ChevronUp, Copy, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCopilotAgents } from "@/hooks/useCopilotAgents";
import type { CopilotWizardData } from "@/types/copilot";

/** Placeholders por template */
const PLACEHOLDERS: Record<
  string,
  {
    productSummary: string;
    idealCustomerProfile: string;
    valueProps: string;
    customerPains: string;
    primaryCta: string;
  }
> = {
  sdr: {
    productSummary:
      "Ex: Plataforma de automação de vendas B2B que integra CRM, WhatsApp e ligações em um só lugar.",
    idealCustomerProfile:
      "Ex: Empresas B2B com time comercial de 5+ vendedores, faturamento acima de R$1M/ano, usando planilhas ou CRM genérico.",
    valueProps:
      "Ex: Reduz tempo de prospecção em 60%, pipeline 3x maior, integração com WhatsApp nativa.",
    customerPains:
      "Ex: Leads esfriando por falta de follow-up, vendedores perdendo tempo com tarefas manuais, sem visibilidade do pipeline.",
    primaryCta: "Ex: Agendar demonstração com especialista",
  },
  qualificador: {
    productSummary:
      "Ex: Consultoria de RH especializada em recrutamento tech para startups e scale-ups.",
    idealCustomerProfile:
      "Ex: Startups e scale-ups com 20+ funcionários buscando contratar 3+ devs nos próximos 3 meses.",
    valueProps:
      "Ex: Time-to-hire 40% menor, 95% retenção em 6 meses, rede de 5000+ devs qualificados.",
    customerPains:
      "Ex: Dificuldade de atrair talentos tech, processo seletivo longo, alta rotatividade nos primeiros meses.",
    primaryCta: "Ex: Agendar call de diagnóstico gratuita",
  },
  prospectador: {
    productSummary:
      "Ex: Software de gestão financeira para PMEs com automação de cobranças e conciliação bancária.",
    idealCustomerProfile:
      "Ex: PMEs com faturamento entre R$500K e R$10M/ano, 2+ funcionários no financeiro, usando planilhas.",
    valueProps:
      "Ex: Reduz inadimplência em 35%, reconciliação automática, dashboard em tempo real.",
    customerPains:
      "Ex: Cobranças manuais, falta de controle de fluxo de caixa, tempo perdido com conciliação.",
    primaryCta: "Ex: Solicitar teste gratuito de 14 dias",
  },
  followup: {
    productSummary:
      "Ex: Plataforma de e-learning corporativo com trilhas personalizadas por cargo e nível.",
    idealCustomerProfile:
      "Ex: Empresas com 50+ funcionários investindo em treinamento, RH ou T&D ativo.",
    valueProps:
      "Ex: Engajamento 3x maior, relatórios de progresso por equipe, conteúdo customizável.",
    customerPains:
      "Ex: Treinamentos caros e pouco efetivos, dificuldade de medir ROI de capacitação.",
    primaryCta: "Ex: Agendar apresentação personalizada",
  },
  agendador: {
    productSummary:
      "Ex: Serviço de agendamento e confirmação de reuniões comerciais com automação WhatsApp.",
    idealCustomerProfile:
      "Ex: Times comerciais que agendam 10+ reuniões/semana e sofrem com no-shows.",
    valueProps:
      "Ex: Reduz no-show em 70%, confirmações automáticas D-5 a D-0, reagendamento instantâneo.",
    customerPains:
      "Ex: Alta taxa de no-show, tempo gasto confirmando manualmente, leads que somem antes da reunião.",
    primaryCta: "Ex: Confirmar presença na reunião",
  },
};

const DEFAULT_PLACEHOLDERS = PLACEHOLDERS.sdr;

/** Char counter com cores dinâmicas */
function CharCounter({ value, min }: { value: string; min: number }) {
  const len = (value || "").length;
  let color = "text-muted-foreground";
  if (len >= min) color = "text-green-500";
  else if (len >= min * 0.4) color = "text-yellow-500";

  return (
    <span className={`text-xs ${color}`}>
      {len} caracteres {len < min && `(mín. ${min})`}
    </span>
  );
}

/** Dialog para importar businessContext de outro agente */
function ImportFromAgentDialog({
  onImport,
}: {
  onImport: (bc: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: agents = [], isLoading } = useCopilotAgents();

  const agentsWithContext = agents.filter(
    (a) => a.business_context && (a.business_context as any)?.companyName
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Copy className="w-3.5 h-3.5" />
          Importar de outro agente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Contexto do Negócio</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : agentsWithContext.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhum agente com contexto de negócio encontrado.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {agentsWithContext.map((agent) => {
              const bc = agent.business_context as any;
              return (
                <button
                  key={agent.id}
                  type="button"
                  className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    onImport(bc);
                    setOpen(false);
                    toast.success(`Contexto importado de "${agent.name}"`);
                  }}
                >
                  <p className="font-medium text-sm">{agent.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {bc?.companyName} · {bc?.productSummary?.slice(0, 60)}…
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BusinessContextStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiSegment, setAiSegment] = useState("");

  const templateType = watch("templateType");
  const ph = PLACEHOLDERS[templateType] || DEFAULT_PLACEHOLDERS;
  const companyName = watch("businessContext.companyName");
  const existingProductSummary = watch("businessContext.productSummary");

  /** Abre o dialog pré-preenchendo com o que já existe no form */
  const openAIDialog = () => {
    if (!companyName || companyName.trim().length < 2) {
      toast.error("Informe o nome da empresa antes de gerar com IA");
      return;
    }
    // Pré-preenche com o que já foi digitado
    setAiDescription(existingProductSummary || "");
    setAiSegment("");
    setShowAIDialog(true);
  };

  /** Chama a edge function com description e segment como contexto */
  const handleGenerateWithAI = async () => {
    setIsGenerating(true);
    setShowAIDialog(false);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-business-context`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
          body: JSON.stringify({
            companyName: companyName.trim(),
            templateType: templateType || "sdr",
            description: aiDescription.trim() || undefined,
            segment: aiSegment.trim() || undefined,
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
        const errMsg = (result?.error as string) || (result?.message as string) || `Erro HTTP ${response.status}`;
        throw new Error(errMsg);
      }

      const bc = result?.businessContext as Record<string, unknown> | undefined;
      if (!bc) throw new Error("Resposta vazia da IA");

      applyBusinessContext(bc);
      toast.success("Contexto gerado com IA! Revise e ajuste os campos.");
    } catch (err: any) {
      console.error("[BusinessContext] Erro ao gerar com IA:", err);
      toast.error("Erro ao gerar com IA", {
        description: err?.message || "Tente novamente em alguns segundos.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  /** Normaliza valor para string (o modelo às vezes retorna arrays) */
  const normalizeToString = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.join(". ");
    if (value != null) return String(value);
    return "";
  };

  /** Aplica um objeto de businessContext no form (apenas campos não-vazios) */
  const applyBusinessContext = (bc: Record<string, unknown>) => {
    const fields = [
      "productSummary",
      "idealCustomerProfile",
      "valueProps",
      "customerPains",
      "primaryCta",
      "serviceRegion",
      "socialProof",
      "pricingPolicy",
      "commercialTerms",
      "businessHoursSla",
      "compliancePolicy",
    ] as const;
    fields.forEach((key) => {
      const str = normalizeToString(bc[key]);
      if (str.trim().length > 0) {
        setValue(`businessContext.${key}`, str, { shouldDirty: true });
      }
    });
    const companyStr = normalizeToString(bc.companyName);
    if (companyStr.trim().length > 0) {
      setValue("businessContext.companyName", companyStr, { shouldDirty: true });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            Contexto do Negócio
          </h2>
          <p className="text-muted-foreground">
            Essas informações deixam o agente mais humano e consistente. Os campos
            marcados com * são os mais impactantes no prompt.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
          <ImportFromAgentDialog onImport={applyBusinessContext} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={openAIDialog}
            disabled={isGenerating || !companyName || companyName.trim().length < 2}
          >
            {isGenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isGenerating ? "Gerando..." : "Preencher com IA"}
          </Button>

          {/* Dialog: contexto para a IA */}
          <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Contextualizar IA
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <p className="text-sm text-muted-foreground">
                  Quanto mais contexto você fornecer, mais preciso e personalizado será o resultado.
                </p>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    O que sua empresa/produto faz? *
                  </label>
                  <Textarea
                    placeholder={`Ex: Somos uma plataforma SaaS de automação de vendas para times B2B. Ajudamos empresas a prospectar clientes via WhatsApp e CRM integrado, com IA para qualificação de leads.`}
                    rows={4}
                    value={aiDescription}
                    onChange={(e) => setAiDescription(e.target.value)}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Descreva o produto/serviço, público-alvo e principais diferenciais.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Segmento de mercado{" "}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: SaaS B2B, Consultoria RH, Varejo, Saúde..."
                    value={aiSegment}
                    onChange={(e) => setAiSegment(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
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
                    disabled={aiDescription.trim().length < 10}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Gerar com IA
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* === Campos obrigatórios (high impact) === */}
      <div className="grid gap-6">
        <FormField
          control={control}
          name="businessContext.companyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da empresa / marca *</FormLabel>
              <FormControl>
                <Input placeholder="Ex: Torque CRM" {...field} />
              </FormControl>
              <FormDescription>Como o agente deve apresentar a empresa.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="businessContext.productSummary"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Produto/serviço (resumo) *</FormLabel>
                <CharCounter value={field.value} min={30} />
              </div>
              <FormControl>
                <Textarea placeholder={ph.productSummary} rows={3} {...field} />
              </FormControl>
              <FormDescription>1 a 3 frases, simples e claras.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="businessContext.idealCustomerProfile"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Perfil de cliente ideal (ICP) *</FormLabel>
                <CharCounter value={field.value} min={30} />
              </div>
              <FormControl>
                <Textarea
                  placeholder={ph.idealCustomerProfile}
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormDescription>Ajuda o agente a qualificar com mais precisão.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="businessContext.valueProps"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Diferenciais / Proposta de valor *</FormLabel>
                <CharCounter value={field.value} min={30} />
              </div>
              <FormControl>
                <Textarea placeholder={ph.valueProps} rows={3} {...field} />
              </FormControl>
              <FormDescription>O que torna sua solução única.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="businessContext.customerPains"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Dores que você resolve *</FormLabel>
                <CharCounter value={field.value} min={20} />
              </div>
              <FormControl>
                <Textarea placeholder={ph.customerPains} rows={3} {...field} />
              </FormControl>
              <FormDescription>O agente usa isso para criar empatia.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="businessContext.primaryCta"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Próximo passo padrão (CTA) *</FormLabel>
              <FormControl>
                <Input placeholder={ph.primaryCta} {...field} />
              </FormControl>
              <FormDescription>O destino principal da conversa.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* === Campos avançados (opcionais, colapsável) === */}
      <div className="border rounded-lg">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50"
        >
          <span className="text-sm font-medium">
            Campos avançados (opcional)
          </span>
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </Button>

        {showAdvanced && (
          <div className="px-4 pb-4 grid gap-5">
            <FormField
              control={control}
              name="businessContext.serviceRegion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Região/atendimento</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Brasil, remoto, SP e região" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="businessContext.socialProof"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prova social</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex: +250 empresas, cases em logística e varejo..."
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
              name="businessContext.pricingPolicy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Política de preços</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex: Não passar preço sem entender volume; trabalhar com faixa..."
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Se pode ou não falar preço de cara.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="businessContext.commercialTerms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Condições comerciais</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex: Prazo de implantação, contrato mínimo, formas de pagamento..."
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
              name="businessContext.businessHoursSla"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Horários / SLA</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: Seg–Sex, 9h–18h; resposta em até 2h"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="businessContext.compliancePolicy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Políticas/Compliance</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex: Não coletar dados sensíveis; LGPD; direcionar para humano em negociações..."
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}
