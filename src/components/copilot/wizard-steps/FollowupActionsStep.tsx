/**
 * Step: Ações Automáticas de Follow-up
 *
 * Versão específica para copilots de follow-up.
 * Em vez de "qualificar/desqualificar", mostra:
 * - Quando lead reengajar (respondeu ao follow-up)
 * - Quando follow-ups esgotarem (sem resposta após máx tentativas)
 * - Quando precisar de humano
 *
 * Internamente usa os mesmos campos (onQualify → reengajou, onDisqualify → esgotou)
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
import { Zap, MessageCircle, Clock, UserPlus, Plus, X, ArrowRightCircle } from "lucide-react";
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
  const { options: whatsappStageOptions } = usePipelineStageOptions("whatsapp");
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
        {/* Mover para etapa */}
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
                  {whatsappStageOptions.map((stage) => (
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
            Mover para pipe
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
                <SelectItem value="confirmacao">Confirmação</SelectItem>
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
            Ao disparar esta ação, o lead será movido para o pipe escolhido na etapa indicada.
          </FormDescription>
        </div>

        {/* Tags a adicionar */}
        <div className="space-y-2">
          <FormLabel>Adicionar tags</FormLabel>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: reengajado, sem_resposta"
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
                Usuário que receberá notificação quando esta ação for disparada
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
                        ? "Que bom ter você de volta! Vi que tivemos uma conversa sobre {assunto}. Posso te ajudar com algo?"
                        : prefix === "onDisqualify"
                        ? "Entendo que o momento pode não ser o ideal. Se algo mudar, estou por aqui! Sucesso!"
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

export function FollowupActionsStep() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Zap className="w-6 h-6 text-primary" />
          Ações de Follow-up
        </h2>
        <p className="text-muted-foreground">
          Configure o que acontece em cada cenário do ciclo de follow-up.
        </p>
      </div>

      <Accordion type="multiple" defaultValue={["onQualify"]} className="space-y-4">
        <ActionSection
          title="Quando Lead Reengajar"
          description="O lead respondeu a um follow-up e retomou a conversa"
          icon={<MessageCircle className="w-5 h-5 text-green-400" />}
          colorClass="bg-green-500/10"
          prefix="onQualify"
        />

        <ActionSection
          title="Quando Follow-ups Esgotarem"
          description="Todas as tentativas foram feitas sem resposta do lead"
          icon={<Clock className="w-5 h-5 text-orange-400" />}
          colorClass="bg-orange-500/10"
          prefix="onDisqualify"
        />

        <ActionSection
          title="Quando Precisar de Humano"
          description="Lead pede ajuda ou situação requer intervenção humana"
          icon={<UserPlus className="w-5 h-5 text-blue-400" />}
          colorClass="bg-blue-500/10"
          prefix="onNeedHuman"
        />
      </Accordion>

      {/* Resumo */}
      <div className="bg-muted/30 border rounded-lg p-4">
        <h4 className="font-semibold mb-2">Fluxo de Follow-up</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-green-400">
              <MessageCircle className="w-4 h-4" />
              <span className="font-medium">Reengajou</span>
            </div>
            <p className="text-muted-foreground">
              Lead respondeu e está ativo novamente na conversa
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-orange-400">
              <Clock className="w-4 h-4" />
              <span className="font-medium">Esgotou</span>
            </div>
            <p className="text-muted-foreground">
              Sem resposta após todas as tentativas de follow-up
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400">
              <UserPlus className="w-4 h-4" />
              <span className="font-medium">Precisa Humano</span>
            </div>
            <p className="text-muted-foreground">
              Situação complexa ou lead pediu intervenção
            </p>
          </div>
        </div>
      </div>

      {/* Dica */}
      <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
        <h4 className="font-semibold text-primary mb-2">Como funciona?</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>O agente envia follow-ups automáticos conforme as regras configuradas na próxima etapa</li>
          <li>Se o lead responder, dispara a ação "Quando Reengajar"</li>
          <li>Se atingir o limite de tentativas sem resposta, dispara "Quando Esgotarem"</li>
          <li>A qualquer momento, se precisar de humano, a transferência é feita automaticamente</li>
        </ul>
      </div>
    </div>
  );
}
