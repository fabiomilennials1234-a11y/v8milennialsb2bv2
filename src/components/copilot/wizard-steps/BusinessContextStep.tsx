/**
 * Step: Contexto do Negócio (melhorado)
 *
 * Campos obrigatórios no topo com char counters,
 * opcionais em seção colapsável "Campos avançados".
 * Placeholders variam por templateType.
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
import { Building2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function BusinessContextStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const templateType = watch("templateType");
  const ph = PLACEHOLDERS[templateType] || DEFAULT_PLACEHOLDERS;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Building2 className="w-6 h-6 text-millennials-yellow" />
          Contexto do Negócio
        </h2>
        <p className="text-muted-foreground">
          Essas informações deixam o agente mais humano e consistente. Os campos
          marcados com * são os mais impactantes no prompt.
        </p>
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
                <Input placeholder="Ex: V8 Millennials" {...field} />
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
