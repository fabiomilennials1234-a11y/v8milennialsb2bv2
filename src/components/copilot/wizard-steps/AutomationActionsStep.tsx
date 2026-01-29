/**
 * Step 17: Ações Automáticas
 *
 * Define o que o agente faz quando qualifica, desqualifica ou precisa de humano.
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Zap, CheckCircle, XCircle, UserPlus, Plus, X } from "lucide-react";
import { useState } from "react";
import type { CopilotWizardData } from "@/types/copilot";

const STAGES = [
  { value: "novo", label: "Novo" },
  { value: "abordado", label: "Abordado" },
  { value: "respondeu", label: "Respondeu" },
  { value: "qualificado", label: "Qualificado" },
  { value: "agendado", label: "Agendado" },
  { value: "aguardando_humano", label: "Aguardando Humano" },
  { value: "descartado", label: "Descartado" },
  { value: "esfriou", label: "Esfriou" },
];

interface ActionSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  colorClass: string;
  prefix: "onQualify" | "onDisqualify" | "onNeedHuman";
}

function ActionSection({
  title,
  description,
  icon,
  colorClass,
  prefix,
}: ActionSectionProps) {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const [newTag, setNewTag] = useState("");

  const tags = watch(`automationActions.${prefix}.addTags`) || [];
  const sendMessage = watch(`automationActions.${prefix}.sendMessage`);

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setValue(`automationActions.${prefix}.addTags`, [...tags, newTag.trim()], {
        shouldValidate: true,
      });
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setValue(
      `automationActions.${prefix}.addTags`,
      tags.filter((t: string) => t !== tag),
      { shouldValidate: true }
    );
  };

  return (
    <AccordionItem value={prefix} className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${colorClass}`}>{icon}</div>
          <div className="text-left">
            <h4 className="font-semibold">{title}</h4>
            <p className="text-sm text-muted-foreground font-normal">
              {description}
            </p>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 pt-4">
        {/* Mover para etapa */}
        <FormField
          control={control}
          name={`automationActions.${prefix}.moveToStage`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mover para etapa</FormLabel>
              <Select 
                onValueChange={(value) => {
                  // Converter "__none__" para string vazia para salvar no banco
                  field.onChange(value === "__none__" ? "" : value);
                }} 
                value={field.value || "__none__"}
                defaultValue={field.value || "__none__"}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma etapa" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__none__">Não mover</SelectItem>
                  {STAGES.map((stage) => (
                    <SelectItem key={stage.value} value={stage.value}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Tags a adicionar */}
        <div className="space-y-2">
          <FormLabel>Adicionar tags</FormLabel>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: qualificado, hot_lead"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), addTag())
              }
            />
            <Button type="button" onClick={addTag} variant="outline" size="sm">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag: string) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        {/* Notificar usuário */}
        <FormField
          control={control}
          name={`automationActions.${prefix}.notifyUserId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notificar usuário (ID)</FormLabel>
              <FormControl>
                <Input
                  placeholder="ID do usuário ou deixe vazio"
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormDescription>
                ID do SDR/Closer a ser notificado (deixe vazio para não notificar)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Enviar mensagem automática */}
        <FormField
          control={control}
          name={`automationActions.${prefix}.sendMessage`}
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel className="cursor-pointer">
                Enviar mensagem automática
              </FormLabel>
            </FormItem>
          )}
        />

        {sendMessage && (
          <FormField
            control={control}
            name={`automationActions.${prefix}.messageTemplate`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Template da mensagem</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={
                      prefix === "onQualify"
                        ? "Perfeito! Vou agendar uma reunião com nosso especialista. Qual o melhor horário para você?"
                        : prefix === "onDisqualify"
                        ? "Entendo! Caso mude de ideia no futuro, estamos à disposição. Tenha um ótimo dia!"
                        : "Um momento, vou transferir você para um de nossos especialistas que pode te ajudar melhor."
                    }
                    className="min-h-[80px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export function AutomationActionsStep() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Zap className="w-6 h-6 text-millennials-yellow" />
          Ações Automáticas
        </h2>
        <p className="text-muted-foreground">
          Configure o que o agente faz automaticamente quando atinge determinados resultados.
        </p>
      </div>

      <Accordion type="multiple" defaultValue={["onQualify"]} className="space-y-4">
        <ActionSection
          title="Quando Qualificar"
          description="Lead atende os critérios e está pronto para avançar"
          icon={<CheckCircle className="w-5 h-5 text-green-400" />}
          colorClass="bg-green-500/10"
          prefix="onQualify"
        />

        <ActionSection
          title="Quando Desqualificar"
          description="Lead não atende os critérios mínimos"
          icon={<XCircle className="w-5 h-5 text-red-400" />}
          colorClass="bg-red-500/10"
          prefix="onDisqualify"
        />

        <ActionSection
          title="Quando Precisar de Humano"
          description="Situação complexa que requer intervenção humana"
          icon={<UserPlus className="w-5 h-5 text-blue-400" />}
          colorClass="bg-blue-500/10"
          prefix="onNeedHuman"
        />
      </Accordion>

      {/* Resumo */}
      <div className="bg-muted/30 border rounded-lg p-4">
        <h4 className="font-semibold mb-2">📋 Resumo do Fluxo</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-4 h-4" />
              <span className="font-medium">Qualificou</span>
            </div>
            <p className="text-muted-foreground">
              Lead está pronto para reunião ou próxima etapa
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-red-400">
              <XCircle className="w-4 h-4" />
              <span className="font-medium">Desqualificou</span>
            </div>
            <p className="text-muted-foreground">
              Lead não tem fit ou não é momento
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400">
              <UserPlus className="w-4 h-4" />
              <span className="font-medium">Precisa Humano</span>
            </div>
            <p className="text-muted-foreground">
              Objeção complexa, reclamação ou dúvida técnica
            </p>
          </div>
        </div>
      </div>

      {/* Dicas */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
        <h4 className="font-semibold text-yellow-400 mb-2">💡 Quando o agente pede ajuda humana?</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Lead menciona reclamação ou problema grave</li>
          <li>Pergunta técnica fora do escopo do agente</li>
          <li>Lead pede explicitamente para falar com humano</li>
          <li>Negociação de preço ou condições especiais</li>
          <li>Situações que requerem julgamento humano</li>
        </ul>
      </div>
    </div>
  );
}
