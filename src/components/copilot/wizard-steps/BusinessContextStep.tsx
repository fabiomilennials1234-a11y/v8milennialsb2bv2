/**
 * Step 8: Contexto do Negócio
 *
 * Coleta informações essenciais para enriquecer o prompt do agente.
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Building2 } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

export function BusinessContextStep() {
  const { control } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Building2 className="w-6 h-6 text-millennials-yellow" />
          Contexto do Negócio
        </h2>
        <p className="text-muted-foreground">
          Essas informações deixam o agente mais humano e consistente.
        </p>
      </div>

      <div className="grid gap-6">
        <FormField
          control={control}
          name="businessContext.companyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da empresa / marca</FormLabel>
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
              <FormLabel>Produto/serviço (resumo)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: Plataforma SaaS de CRM com IA para vendas e atendimento..."
                  rows={3}
                  {...field}
                />
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
              <FormLabel>Perfil de cliente ideal (ICP)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: Empresas B2B com equipe comercial entre 3 e 50 vendedores..."
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
              <FormLabel>Diferenciais / Proposta de valor</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: Automação de follow-up, pipeline inteligente, relatórios em tempo real..."
                  rows={3}
                  {...field}
                />
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
              <FormLabel>Dores que você resolve</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: Perda de leads, baixa produtividade, falta de previsibilidade..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormDescription>O agente usa isso para criar empatia.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={control}
            name="businessContext.serviceRegion"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Região/atendimento (opcional)</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Brasil, remoto, SP e região" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="businessContext.primaryCta"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Próximo passo padrão (CTA)</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Agendar reunião com especialista" {...field} />
                </FormControl>
                <FormDescription>O destino principal da conversa.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={control}
          name="businessContext.socialProof"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prova social (opcional)</FormLabel>
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
              <FormLabel>Política de preços (opcional)</FormLabel>
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
              <FormLabel>Condições comerciais (opcional)</FormLabel>
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
              <FormLabel>Horários / SLA (opcional)</FormLabel>
              <FormControl>
                <Input placeholder="Ex: Seg–Sex, 9h–18h; resposta em até 2h" {...field} />
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
              <FormLabel>Políticas/Compliance (opcional)</FormLabel>
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
    </div>
  );
}
