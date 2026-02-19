/**
 * Step: Ações do Confirmador
 *
 * Versão específica para copilots de confirmação de reunião.
 * Em vez de "qualificar/desqualificar", mostra:
 * - Quando lead confirmar presença
 * - Quando lead cancelar ou não comparecer (no-show)
 * - Quando precisar de humano
 *
 * Internamente usa os mesmos campos (onQualify → confirmou, onDisqualify → cancelou/no-show)
 * para manter compatibilidade com o schema existente.
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
import { Zap, CheckCircle2, XCircle, UserPlus, Plus, X, ArrowRightCircle } from "lucide-react";
import { useState } from "react";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import type { CopilotWizardData } from "@/types/copilot";
import { usePipelineStageOptions } from "@/hooks/usePipelineStages";

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
  const { data: teamMembers = [] } = useTeamMembers();
  const { options: confirmacaoOptions } = usePipelineStageOptions("confirmacao");
  const { options: propostasOptions } = usePipelineStageOptions("propostas");

  const tags = watch(`automationActions.${prefix}.addTags`) || [];
  const sendMessage = watch(`automationActions.${prefix}.sendMessage`);
  const moveToPipe = watch(`automationActions.${prefix}.moveToPipe`);

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
        {/* Mover para etapa no pipe de confirmação */}
        <FormField
          control={control}
          name={`automationActions.${prefix}.moveToStage`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mover para etapa</FormLabel>
              <Select
                onValueChange={(value) => {
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
                  {confirmacaoOptions.map((stage) => (
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

        {/* Mover para outro pipe */}
        <div className="space-y-2">
          <FormLabel className="flex items-center gap-2">
            <ArrowRightCircle className="w-4 h-4" />
            Mover para outro pipe
          </FormLabel>
          <div className="flex gap-2 flex-wrap">
            <Select
              value={moveToPipe?.pipe ?? "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setValue(`automationActions.${prefix}.moveToPipe`, null, {
                    shouldValidate: true,
                  });
                } else {
                  const defaultStage =
                    v === "confirmacao"
                      ? confirmacaoOptions[0]?.value || ""
                      : propostasOptions[0]?.value || "";
                  setValue(
                    `automationActions.${prefix}.moveToPipe`,
                    { pipe: v as "confirmacao" | "propostas", stage: defaultStage },
                    { shouldValidate: true }
                  );
                }
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nenhum</SelectItem>
                <SelectItem value="propostas">Propostas</SelectItem>
              </SelectContent>
            </Select>
            {moveToPipe?.pipe && (
              <Select
                value={moveToPipe.stage}
                onValueChange={(stage) =>
                  setValue(
                    `automationActions.${prefix}.moveToPipe`,
                    { ...moveToPipe, stage },
                    { shouldValidate: true }
                  )
                }
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Etapa" />
                </SelectTrigger>
                <SelectContent>
                  {(moveToPipe.pipe === "confirmacao"
                    ? confirmacaoOptions
                    : propostasOptions
                  ).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <FormDescription>
            Opcional: mover o lead para o pipe de Propostas após a reunião.
          </FormDescription>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <FormLabel>Adicionar tags</FormLabel>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: confirmado, no_show, reagendado"
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

        {/* Notificar */}
        <FormField
          control={control}
          name={`automationActions.${prefix}.notifyUserId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notificar usuário</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(value === "__none__" ? null : value)}
                value={field.value || "__none__"}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um membro da equipe" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__none__">Não notificar</SelectItem>
                  {teamMembers
                    .filter((tm) => tm.user_id)
                    .map((tm) => (
                      <SelectItem key={tm.id} value={tm.user_id!}>
                        {tm.name || "Sem nome"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Quem recebe notificação quando esta ação é disparada
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Mensagem automática */}
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
                        ? "Presença confirmada! Nos vemos em {data} às {hora}. Aqui está o link: {link}"
                        : prefix === "onDisqualify"
                        ? "Sem problemas! Vou verificar novas opções de horário. Qual semana seria melhor para você?"
                        : "Entendido, vou transferir para nosso time verificar pessoalmente. Um momento."
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

export function ConfirmerActionsStep() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Zap className="w-6 h-6 text-primary" />
          Ações do Confirmador
        </h2>
        <p className="text-muted-foreground">
          Configure o que acontece em cada resultado do processo de confirmação.
        </p>
      </div>

      <Accordion type="multiple" defaultValue={["onQualify"]} className="space-y-4">
        <ActionSection
          title="Quando Lead Confirmar Presença"
          description="O lead confirmou que vai comparecer à reunião"
          icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
          colorClass="bg-green-500/10"
          prefix="onQualify"
        />

        <ActionSection
          title="Quando Cancelar ou Não Comparecer"
          description="O lead cancelou, não respondeu, ou deu no-show na reunião"
          icon={<XCircle className="w-5 h-5 text-red-400" />}
          colorClass="bg-red-500/10"
          prefix="onDisqualify"
        />

        <ActionSection
          title="Quando Precisar de Humano"
          description="Situação complexa que requer intervenção humana (reclamação, problema técnico)"
          icon={<UserPlus className="w-5 h-5 text-blue-400" />}
          colorClass="bg-blue-500/10"
          prefix="onNeedHuman"
        />
      </Accordion>

      {/* Resumo visual */}
      <div className="bg-muted/30 border rounded-lg p-4">
        <h4 className="font-semibold mb-2">Fluxo do Confirmador</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-medium">Confirmou</span>
            </div>
            <p className="text-muted-foreground">
              Lead confirmou presença, avança no funil
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-red-400">
              <XCircle className="w-4 h-4" />
              <span className="font-medium">Cancelou / No-Show</span>
            </div>
            <p className="text-muted-foreground">
              Tenta reagendar antes de marcar como perdido
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400">
              <UserPlus className="w-4 h-4" />
              <span className="font-medium">Precisa Humano</span>
            </div>
            <p className="text-muted-foreground">
              Problema complexo, transfere para equipe
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
