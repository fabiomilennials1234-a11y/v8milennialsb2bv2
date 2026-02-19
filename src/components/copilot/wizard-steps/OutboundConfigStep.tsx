/**
 * Step 16: Configuração de Outbound
 *
 * Define o delay, template da primeira mensagem e configurações de retry.
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
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Clock, RefreshCw, Variable } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

const AVAILABLE_VARIABLES = [
  { name: "{nome}", description: "Nome do lead" },
  { name: "{empresa}", description: "Empresa do lead" },
  { name: "{email}", description: "Email do lead" },
  { name: "{telefone}", description: "Telefone do lead" },
  { name: "{origem}", description: "Origem do lead (meta_ads, etc)" },
  { name: "{interesse}", description: "Campo de interesse (se houver)" },
  { name: "{segmento}", description: "Segmento do lead" },
  { name: "{campanha}", description: "Nome da campanha" },
];

export function OutboundConfigStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const template = watch("outboundConfig.firstMessageTemplate") || "";

  const insertVariable = (variable: string) => {
    const currentTemplate = watch("outboundConfig.firstMessageTemplate") || "";
    setValue("outboundConfig.firstMessageTemplate", currentTemplate + variable, {
      shouldValidate: true,
    });
  };

  // Simular preview da mensagem
  const previewMessage = template
    .replace("{nome}", "Maria")
    .replace("{empresa}", "Tech Corp")
    .replace("{email}", "maria@techcorp.com")
    .replace("{telefone}", "11999999999")
    .replace("{origem}", "Meta Ads")
    .replace("{interesse}", "CRM com IA")
    .replace("{segmento}", "Tecnologia")
    .replace("{campanha}", "Black Friday 2026");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          Configuração de Outbound
        </h2>
        <p className="text-muted-foreground">
          Configure como o agente vai fazer o primeiro contato com leads.
        </p>
      </div>

      {/* Delay */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FormField
          control={control}
          name="outboundConfig.delayMinutes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Delay antes do contato
              </FormLabel>
              <FormControl>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    placeholder="5"
                    value={field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-muted-foreground">minutos</span>
                </div>
              </FormControl>
              <FormDescription>
                Tempo de espera após o lead entrar no sistema (0 = imediato, máx 24h)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="outboundConfig.maxRetries"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Tentativas máximas
              </FormLabel>
              <FormControl>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    placeholder="3"
                    value={field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-muted-foreground">tentativas</span>
                </div>
              </FormControl>
              <FormDescription>
                Se o envio falhar, quantas vezes tentar novamente
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Template da Primeira Mensagem */}
      <div className="space-y-4">
        <FormField
          control={control}
          name="outboundConfig.firstMessageTemplate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Template da Primeira Mensagem
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Oi {nome}! Vi que você demonstrou interesse em {interesse} através da nossa campanha. O que mais te chamou atenção?"
                  className="min-h-[120px] font-mono"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Use as variáveis abaixo para personalizar a mensagem
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Variáveis disponíveis */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Variable className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Variáveis disponíveis (clique para inserir):</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_VARIABLES.map((variable) => (
              <Badge
                key={variable.name}
                variant="outline"
                className="cursor-pointer hover:bg-primary/20 transition-colors"
                onClick={() => insertVariable(variable.name)}
                title={variable.description}
              >
                {variable.name}
              </Badge>
            ))}
          </div>
        </div>

        {/* Preview */}
        {template && (
          <div className="bg-muted/30 border rounded-lg p-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              👁️ Preview da Mensagem
            </h4>
            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3">
              <p className="text-sm whitespace-pre-wrap">{previewMessage}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              * Preview com dados de exemplo
            </p>
          </div>
        )}
      </div>

      {/* Dicas */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <h4 className="font-semibold text-blue-400 mb-2">💡 Dicas para primeira mensagem</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Mantenha curta (2-3 frases)</li>
          <li>Mencione o nome do lead para personalização</li>
          <li>Faça referência ao interesse ou campanha</li>
          <li>Termine com uma pergunta aberta</li>
          <li>Evite parecer automático ou spam</li>
        </ul>
      </div>

      {/* Exemplos */}
      <div className="space-y-3">
        <h4 className="font-semibold">📝 Exemplos de mensagens</h4>
        
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() =>
              setValue(
                "outboundConfig.firstMessageTemplate",
                "Oi {nome}! 👋 Vi que você demonstrou interesse em {interesse}. O que mais te chamou atenção sobre isso?",
                { shouldValidate: true }
              )
            }
            className="text-left p-3 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-primary">Abordagem Curiosa</span>
            <p className="text-sm text-muted-foreground mt-1">
              "Oi {"{nome}"}! 👋 Vi que você demonstrou interesse em {"{interesse}"}. O que mais te chamou atenção sobre isso?"
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setValue(
                "outboundConfig.firstMessageTemplate",
                "Olá {nome}, tudo bem? Sou da {empresa} e vi que você se cadastrou na nossa campanha. Posso te ajudar com alguma dúvida?",
                { shouldValidate: true }
              )
            }
            className="text-left p-3 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-primary">Abordagem Solícita</span>
            <p className="text-sm text-muted-foreground mt-1">
              "Olá {"{nome}"}, tudo bem? Sou da {"{empresa}"} e vi que você se cadastrou na nossa campanha. Posso te ajudar com alguma dúvida?"
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setValue(
                "outboundConfig.firstMessageTemplate",
                "E aí {nome}! Vi que você tá procurando {interesse}. Deixa eu te fazer uma pergunta rápida: qual o maior desafio que você enfrenta hoje nessa área?",
                { shouldValidate: true }
              )
            }
            className="text-left p-3 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-primary">Abordagem Direta</span>
            <p className="text-sm text-muted-foreground mt-1">
              "E aí {"{nome}"}! Vi que você tá procurando {"{interesse}"}. Deixa eu te fazer uma pergunta rápida: qual o maior desafio que você enfrenta hoje nessa área?"
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
