import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mic, MicOff, Upload, Trash2, Play, Square, Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActionCategories, ACTION_LABELS, UNIFIED_MESSAGE_NODE_FLAG } from "@/types/workflow";
import type { ActionNodeData, WorkflowActionType, MessageType } from "@/types/workflow";
import {
  CAMPOS_DO_NO_DE_TEMPLATE,
  EscapeDeJanelaConfig,
  MenuNodeConfig,
  PixButtonNodeConfig,
  TemplateNodeConfig,
} from "@/modules/workflows/components/action-configs";
import { modoDeMensagemDoNo } from "@/contracts/workflows/modo-de-mensagem";
import { useFeatureFlag } from "@/modules/platform";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { InstanceRoutingSelector } from "./InstanceRoutingSelector";
import { isInstanceRoutedAction } from "@/modules/workflows/lib/instance-routing";
import { useOrganization } from "@/modules/identity";
import { useCampaignTemplatesByType } from "@/modules/campaigns/hooks/useCampaignTemplates";
import { supabase } from "@/integrations/supabase/client";
import { useTeamMembers } from "@/modules/identity";
import { convertAudioBlobToMp3, preloadLamejs } from "@/modules/communication/lib/audioToMp3";
import { toast } from "sonner";
import { VariableInserter } from "@/modules/workflows/components/VariableInserter";
import {
  TemplateTextarea,
  type TemplateTextareaHandle,
} from "@/modules/workflows/components/TemplateTextarea";
import type { CampaignTemplate } from "@/modules/campaigns/hooks/useCampaignTemplates";
import { useFunisDaOrg, useEtapasDoFunil, usePipelineDisplayConfig } from "@/modules/pipelines";
import { destinosDeSistema } from "@/contracts/pipe";
import { useTags } from "@/modules/leads/hooks/useTags";
import { CampaignSelectorField } from "./CampaignSelectorField";
import { CampaignStageSelectorField } from "./CampaignStageSelectorField";
import { CampaignTemplateSelectorField } from "./CampaignTemplateSelectorField";
import { useChecklistTemplates } from "@/modules/engagement/hooks/useChecklistTemplates";
import { useChecklistItems } from "@/modules/engagement/hooks/useChecklists";

/**
 * Dono do Negócio — escreve nos DOIS lugares (`deals.owner_id` e
 * `pipeline_entries.assigned_to`), por isso o rótulo fala de negócio e não de
 * lead: trocar o dono aqui não mexe no responsável da PESSOA.
 */
function SetDealOwnerConfig({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: members = [] } = useTeamMembers();
  const activeMembers = members.filter((m) => m.is_active);

  return (
    <div className="space-y-2">
      <Label>Novo dono do negócio</Label>
      <Select
        value={data.dealOwnerId || ""}
        onValueChange={(v) => onUpdate({ dealOwnerId: v })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione um membro" />
        </SelectTrigger>
        <SelectContent>
          {activeMembers.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Muda o dono do NEGÓCIO — o responsável pela pessoa continua como está.
      </p>
    </div>
  );
}

function AssignResponsibleConfig({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: members = [] } = useTeamMembers();
  const activeMembers = members.filter((m) => m.is_active);

  return (
    <>
      <div className="space-y-2">
        <Label>Modo de Atribuição</Label>
        <Select
          value={data.assignMode || "specific"}
          onValueChange={(v) =>
            onUpdate({ assignMode: v as "specific" | "round_robin" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="specific">Usuário Específico</SelectItem>
            <SelectItem value="round_robin">Round Robin (distribuir)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.assignMode === "specific" && (
        <div className="space-y-2">
          <Label>Responsável</Label>
          <Select
            value={data.assigneeId || ""}
            onValueChange={(v) => {
              const member = activeMembers.find((m) => m.id === v);
              onUpdate({
                assigneeId: v,
                assigneeName: member?.name || "",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o responsável" />
            </SelectTrigger>
            <SelectContent>
              {activeMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}{m.role ? ` (${m.role})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}

function CreateDealConfig({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: members = [] } = useTeamMembers();
  const activeMembers = members.filter((m) => m.is_active);
  const valueMode = data.dealValueMode || "fixed";
  const ownerMode = data.dealOwnerMode || "lead_responsible";

  return (
    <>
      <div className="space-y-2">
        <Label>Título do negócio</Label>
        <Input
          value={data.dealTitleTemplate ?? "Negócio — {{nome}}"}
          onChange={(e) => onUpdate({ dealTitleTemplate: e.target.value })}
          placeholder="Negócio — {{nome}}"
        />
        <p className="text-xs text-muted-foreground">
          Aceita variáveis do lead: {"{{nome}}"}, {"{{empresa}}"}.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Valor</Label>
        <Select
          value={valueMode}
          onValueChange={(v) => onUpdate({ dealValueMode: v as "fixed" | "proposal" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Valor fixo</SelectItem>
            <SelectItem value="proposal">Valor da proposta do lead</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {valueMode === "fixed" && (
        <div className="space-y-2">
          <Label>Valor (R$)</Label>
          <Input
            type="number"
            min={0}
            step={0.01}
            value={data.dealValue ?? ""}
            onChange={(e) => onUpdate({ dealValue: Number(e.target.value) })}
            placeholder="0,00"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>Probabilidade (%)</Label>
        <Input
          type="number"
          min={0}
          max={100}
          value={data.dealProbability ?? 50}
          onChange={(e) => onUpdate({ dealProbability: Number(e.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <Label>Responsável do negócio</Label>
        <Select
          value={ownerMode}
          onValueChange={(v) =>
            onUpdate({ dealOwnerMode: v as "lead_responsible" | "specific" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lead_responsible">Responsável do lead</SelectItem>
            <SelectItem value="specific">Membro específico</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {ownerMode === "specific" && (
        <div className="space-y-2">
          <Label>Membro</Label>
          <Select
            value={data.dealOwnerId || ""}
            onValueChange={(v) => {
              const member = activeMembers.find((m) => m.id === v);
              onUpdate({ dealOwnerId: v, dealOwnerName: member?.name || "" });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o membro" />
            </SelectTrigger>
            <SelectContent>
              {activeMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}{m.role ? ` (${m.role})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Previsão de fechamento (dias)</Label>
        <Input
          type="number"
          min={0}
          value={data.dealExpectedCloseDays ?? ""}
          onChange={(e) => onUpdate({ dealExpectedCloseDays: Number(e.target.value) })}
          placeholder="Ex: 30 (vazio = sem previsão)"
        />
      </div>

      <div className="space-y-2">
        <Label>Observações (opcional)</Label>
        <Textarea
          value={data.dealNotes || ""}
          onChange={(e) => onUpdate({ dealNotes: e.target.value })}
          placeholder="Contexto do negócio. Aceita variáveis."
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div className="space-y-0.5 pr-3">
          <Label className="text-sm">Não duplicar negócio aberto</Label>
          <p className="text-xs text-muted-foreground">
            Se o lead já tem um negócio em aberto, o nó não cria outro.
          </p>
        </div>
        <Switch
          checked={data.dealSkipIfOpenExists !== false}
          onCheckedChange={(v) => onUpdate({ dealSkipIfOpenExists: v })}
        />
      </div>
    </>
  );
}

function ApplyChecklistConfig({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: templates = [], isLoading } = useChecklistTemplates();

  return (
    <div className="space-y-2">
      <Label>Template de Checklist</Label>
      <Select
        value={data.checklistTemplateId || ""}
        onValueChange={(v) => {
          const tpl = templates.find((t) => t.id === v);
          onUpdate({
            checklistTemplateId: v,
            checklistTemplateName: tpl?.title || "",
          });
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={isLoading ? "Carregando..." : "Selecione o template"} />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.title} ({t.total_items} itens)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Cria uma cópia do checklist no lead quando o workflow executar.
      </p>
    </div>
  );
}

function SendToNumberConfig({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const taRef = useRef<TemplateTextareaHandle>(null);
  // Always render at least one input row so the operator has somewhere to type.
  const phones = (data.notifyPhones && data.notifyPhones.length > 0)
    ? data.notifyPhones
    : [""];

  const updatePhone = (index: number, value: string) => {
    const next = [...phones];
    next[index] = value;
    onUpdate({ notifyPhones: next });
  };

  const addPhone = () => onUpdate({ notifyPhones: [...phones, ""] });

  const removePhone = (index: number) => {
    const next = phones.filter((_, i) => i !== index);
    onUpdate({ notifyPhones: next.length > 0 ? next : [""] });
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Números de destino</Label>
        <div className="space-y-2">
          {phones.map((phone, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={phone}
                onChange={(e) => updatePhone(index, e.target.value)}
                placeholder="Ex: 5511999998888"
                inputMode="tel"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removePhone(index)}
                disabled={phones.length === 1 && !phone}
                title="Remover número"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addPhone}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Adicionar número
        </Button>
        <p className="text-xs text-muted-foreground">
          A mensagem é enviada para cada número (com DDI/DDD, ex: 55 + DDD +
          número). Não é o número do lead — use para avisar um vendedor.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Mensagem</Label>
        <VariableInserter onInsert={(v) => taRef.current?.insertAtCursor(v)} />
        <TemplateTextarea
          ref={taRef}
          value={data.messageTemplate || ""}
          onChange={(v) => onUpdate({ messageTemplate: v })}
          placeholder="Lead {{nome}} ({{empresa}}) respondeu. Assuma a conversa."
          rows={4}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="space-y-0.5 pr-2">
          <Label className="text-sm">Resumir conversa do lead ao enviar</Label>
          <p className="text-xs text-muted-foreground">
            Anexa um resumo da conversa (IA) + o telefone do lead à mensagem,
            para o vendedor ter contexto.
          </p>
        </div>
        <Switch
          checked={!!data.includeConversationSummary}
          onCheckedChange={(v) => onUpdate({ includeConversationSummary: v })}
        />
      </div>
    </>
  );
}

function MarkChecklistItemConfig({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: templates = [], isLoading: loadingTemplates } = useChecklistTemplates();
  // Os itens do template são carregados pelo id do template (checklist_id === templateId).
  // O id de cada item É o template_item_id que o node guarda pra endereçar a cópia no lead (ADR-0016).
  const { data: items = [], isLoading: loadingItems } = useChecklistItems(
    data.checklistTemplateId || null,
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Checklist (template)</Label>
        <Select
          value={data.checklistTemplateId || ""}
          onValueChange={(v) => {
            const tpl = templates.find((t) => t.id === v);
            // Troca de template invalida o item selecionado.
            onUpdate({
              checklistTemplateId: v,
              checklistTemplateName: tpl?.title || "",
              checklistItemTemplateId: undefined,
              checklistItemTitle: undefined,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={loadingTemplates ? "Carregando..." : "Selecione o checklist"} />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.title} ({t.total_items} itens)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Item para marcar</Label>
        <Select
          value={data.checklistItemTemplateId || ""}
          disabled={!data.checklistTemplateId || loadingItems}
          onValueChange={(v) => {
            const item = items.find((i) => i.id === v);
            onUpdate({
              checklistItemTemplateId: v,
              checklistItemTitle: item?.title || "",
            });
          }}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                !data.checklistTemplateId
                  ? "Escolha o checklist primeiro"
                  : loadingItems
                    ? "Carregando..."
                    : "Selecione o item"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Ação</Label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: "mark", label: "Marcar" },
            { value: "unmark", label: "Desmarcar" },
          ] as const).map((opt) => {
            const active = (data.checklistItemAction ?? "mark") === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                className={cn(!active && "text-muted-foreground")}
                onClick={() => onUpdate({ checklistItemAction: opt.value })}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {(data.checklistItemAction ?? "mark") === "unmark"
          ? "Desmarca este item no checklist do lead (reabre a etapa) quando o workflow executar."
          : "Marca este item no checklist do lead quando o workflow executar."}{" "}
        Se o lead ainda não tiver o checklist, o node não faz nada (fica registrado na execução).
      </p>
    </div>
  );
}

interface ActionPanelProps {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}

export function ActionPanel({ data, onUpdate }: ActionPanelProps) {
  const at = data.actionType;
  // Funis de sistema REAIS da org, com o nome que ELA usa (SCRUM-641). O value
  // continua o sentinel legado `pipe_<type>` — é o contrato do executor.
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const funisDeSistema = destinosDeSistema(displayConfigs);
  const opcoesDePipe = funisDeSistema.map((d) => ({
    value: `pipe_${d.pipeType}`,
    label: d.label,
  }));
  const nomeConfirmacao =
    funisDeSistema.find((d) => d.pipeType === "confirmacao")?.label ?? "Funil removido";
  // Node unificado gateado por org (ADR-0012). Fail-closed: enquanto carrega ou
  // se a org não tem a flag, o picker mostra os envios legados, como antes.
  const { enabled: unifiedEnabled } = useFeatureFlag(UNIFIED_MESSAGE_NODE_FLAG);
  const { hasFeature } = useOrgFeatures();
  // Categoria Negócios só aparece para org com o módulo ligado (feature `deals`).
  const actionCategories = getActionCategories(unifiedEnabled).filter(
    (c) => c.label !== "Negócios" || hasFeature("deals"),
  );

  return (
    <div className="space-y-4">
      {/* Nome */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Enviar mensagem de boas-vindas"
        />
      </div>

      {/* Tipo de Ação (agrupado por categoria) */}
      <div className="space-y-2">
        <Label>Tipo de Ação</Label>
        <Select
          value={at}
          onValueChange={(v) => onUpdate({ actionType: v as WorkflowActionType })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a ação" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {actionCategories.map((cat) => (
              <SelectGroup key={cat.label}>
                <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                  {cat.label}
                </SelectLabel>
                {cat.actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ═══════ COMUNICAÇÃO ═══════ */}

      {/* WhatsApp Instance Selector (shared by all WhatsApp actions) */}
      {isInstanceRoutedAction(at) && (
        <InstanceRoutingSelector
          data={data}
          onUpdate={onUpdate}
          fixedOnly={at === "send_to_number"}
        />
      )}

      {/* Unified "Enviar Mensagem" node (ADR-0012) */}
      {at === "send_whatsapp_message" && (
        <UnifiedMessagePanel data={data} onUpdate={onUpdate} />
      )}

      {/* Send WhatsApp (Texto) */}
      {at === "send_whatsapp" && (
        <WhatsAppTextPanel data={data} onUpdate={onUpdate} />
      )}

      {/* Send WhatsApp (Áudio) */}
      {at === "send_whatsapp_audio" && (
        <WhatsAppAudioPanel data={data} onUpdate={onUpdate} />
      )}

      {/* Send WhatsApp (Imagem) */}
      {at === "send_whatsapp_image" && (
        <WhatsAppImagePanel data={data} onUpdate={onUpdate} />
      )}

      {/* Send WhatsApp (Figurinha) */}
      {at === "send_whatsapp_sticker" && (
        <div className="space-y-2">
          <Label>URL da Figurinha</Label>
          <Input
            value={data.stickerUrl || ""}
            onChange={(e) => onUpdate({ stickerUrl: e.target.value })}
            placeholder="https://... (PNG ou WebP, idealmente 512x512)"
          />
          <p className="text-xs text-muted-foreground">
            Imagem PNG ou WebP. Recomendado 512×512px com fundo transparente.
          </p>
        </div>
      )}

      {/* Send WhatsApp (Vídeo) */}
      {at === "send_whatsapp_video" && (
        <WhatsAppVideoPanel data={data} onUpdate={onUpdate} />
      )}

      {/* Send WhatsApp (Documento) */}
      {at === "send_whatsapp_document" && (
        <WhatsAppDocumentPanel data={data} onUpdate={onUpdate} />
      )}

      {/* Send WhatsApp Template — canal oficial (#1688) */}
      {at === "send_whatsapp_template" && (
        <TemplateNodeConfig data={data} onUpdate={onUpdate} />
      )}

      {/* Instagram Direct — texto, imagem, vídeo e áudio.
          Documento e figurinha ficam de fora: o Direct não os tem. */}
      {at === "send_meta_message" && (
        <>
          <div className="space-y-2">
            <Label>Tipo de mensagem</Label>
            <Select
              value={data.metaMessageType || "texto"}
              onValueChange={(v) =>
                onUpdate({
                  metaMessageType: v as "texto" | "imagem" | "video" | "audio",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="texto">Texto</SelectItem>
                <SelectItem value="imagem">Imagem</SelectItem>
                <SelectItem value="video">Vídeo</SelectItem>
                <SelectItem value="audio">Áudio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(data.metaMessageType || "texto") === "texto" ? (
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={data.metaMessage || ""}
                onChange={(e) => onUpdate({ metaMessage: e.target.value })}
                placeholder="Olá {{nome}}!"
                rows={3}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>URL do arquivo</Label>
                <Input
                  value={data.metaMediaUrl || ""}
                  onChange={(e) => onUpdate({ metaMediaUrl: e.target.value })}
                  placeholder="https://..."
                />
                <p className="text-xs text-muted-foreground">
                  Precisa ser um endereço https público — quem baixa o arquivo é
                  o Instagram, não o Torque.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Legenda (opcional)</Label>
                <Textarea
                  value={data.metaCaption || ""}
                  onChange={(e) => onUpdate({ metaCaption: e.target.value })}
                  placeholder="Olá {{nome}}, segue o catálogo!"
                  rows={2}
                />
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Só age em conversas do Direct que alguém já vinculou a um lead pelo
            botão do chat. Lead sem conversa vinculada: o nó não envia nada e o
            workflow segue.
          </p>
        </>
      )}

      {/* Send Semi-Automatic */}
      {at === "send_semi_automatic" && (
        <>
          <div className="space-y-2">
            <Label>Mensagem sugerida</Label>
            <Textarea
              value={data.semiAutoMessage || ""}
              onChange={(e) => onUpdate({ semiAutoMessage: e.target.value })}
              placeholder="Sugestão de mensagem para o SDR aprovar"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              O SDR verá esta mensagem como sugestão e poderá editar antes de
              enviar.
            </p>
          </div>
        </>
      )}

      {/* Send to fixed number(s) */}
      {at === "send_to_number" && (
        <SendToNumberConfig data={data} onUpdate={onUpdate} />
      )}

      {/* ═══════ LEAD MANAGEMENT ═══════ */}

      {/* Move Stage */}
      {at === "move_stage" && (
        <MoveStageFields data={data} onUpdate={onUpdate} />
      )}

      {/* Add/Remove Tag */}
      {(at === "add_tag" || at === "remove_tag") && (
        <TagSelectorField data={data} onUpdate={onUpdate} />
      )}

      {/* Update Lead Field */}
      {at === "update_lead_field" && (
        <>
          <div className="space-y-2">
            <Label>Campo</Label>
            <Select
              value={data.fieldName || ""}
              onValueChange={(v) => onUpdate({ fieldName: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Nome</SelectItem>
                <SelectItem value="company">Empresa</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Telefone</SelectItem>
                <SelectItem value="faturamento">Faturamento</SelectItem>
                <SelectItem value="segment">Segmento</SelectItem>
                <SelectItem value="urgency">Urgência</SelectItem>
                <SelectItem value="notes">Notas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Novo valor</Label>
            <Input
              value={data.fieldValue || ""}
              onChange={(e) => onUpdate({ fieldValue: e.target.value })}
              placeholder="Novo valor do campo"
            />
          </div>
        </>
      )}

      {/* Update Custom Field */}
      {at === "update_custom_field" && (
        <>
          <div className="space-y-2">
            <Label>Nome do campo customizado</Label>
            <Input
              value={data.customFieldName || ""}
              onChange={(e) => onUpdate({ customFieldName: e.target.value })}
              placeholder="Ex: cargo, cnpj"
            />
          </div>
          <div className="space-y-2">
            <Label>Novo valor</Label>
            <Input
              value={data.customFieldValue || ""}
              onChange={(e) => onUpdate({ customFieldValue: e.target.value })}
              placeholder="Novo valor"
            />
          </div>
        </>
      )}

      {/* Update Rating */}
      {at === "update_rating" && (
        <div className="space-y-2">
          <Label>Rating (0-10): {data.ratingValue ?? 5}</Label>
          <Slider
            value={[data.ratingValue ?? 5]}
            onValueChange={([v]) => onUpdate({ ratingValue: v })}
            min={0}
            max={10}
            step={1}
          />
        </div>
      )}

      {/* Calculate Score */}
      {at === "calculate_score" && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-700 dark:text-green-300">
            Chama a IA para calcular o lead score automaticamente com base nos
            dados do lead e histórico de conversas.
          </p>
        </div>
      )}

      {/* Duplicate to Pipe */}
      {at === "duplicate_to_pipe" && (
        <>
          <div className="space-y-2">
            <Label>Pipe destino</Label>
            <Select
              value={data.targetPipeType || ""}
              onValueChange={(v) => onUpdate({ targetPipeType: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {opcoesDePipe.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Estágio inicial</Label>
            <Input
              value={data.targetPipeStage || ""}
              onChange={(e) => onUpdate({ targetPipeStage: e.target.value })}
              placeholder="Ex: novo"
            />
          </div>
        </>
      )}

      {/* Remove from Pipe */}
      {at === "remove_from_pipe" && (
        <div className="space-y-2">
          <Label>Pipe</Label>
          <Select
            value={data.pipeType || ""}
            onValueChange={(v) => onUpdate({ pipeType: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {opcoesDePipe.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Mark as Lost */}
      {at === "mark_as_lost" && (
        <>
          <div className="space-y-2">
            <Label>Pipe</Label>
            <Select
              value={data.pipeType || ""}
              onValueChange={(v) => onUpdate({ pipeType: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {opcoesDePipe.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Motivo da perda (opcional)</Label>
            <Input
              value={data.lostReason || ""}
              onChange={(e) => onUpdate({ lostReason: e.target.value })}
              placeholder="Ex: Sem interesse, orçamento"
            />
          </div>
        </>
      )}

      {/* ═══════ CAMPANHAS ═══════ */}

      {at === "add_to_campaign" && (
        <CampaignSelectorField
          campaignId={data.campaignId || ""}
          onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
        />
      )}

      {at === "remove_from_campaign" && (
        <CampaignSelectorField
          campaignId={data.campaignId || ""}
          onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
        />
      )}

      {at === "move_campaign_stage" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) =>
              onUpdate({
                campaignId: id,
                campaignName: name,
                campaignStageId: "",
                campaignStageName: "",
              })
            }
          />
          <CampaignStageSelectorField
            campanhaId={data.campaignId || ""}
            stageId={data.campaignStageId || ""}
            onSelect={(id, name) =>
              onUpdate({ campaignStageId: id, campaignStageName: name })
            }
          />
        </>
      )}

      {at === "send_campaign_message" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) =>
              onUpdate({
                campaignId: id,
                campaignName: name,
                campaignTemplateId: "",
                campaignTemplateName: "",
              })
            }
          />
          <CampaignTemplateSelectorField
            campanhaId={data.campaignId || ""}
            templateId={data.campaignTemplateId || ""}
            onSelect={(id, name) =>
              onUpdate({ campaignTemplateId: id, campaignTemplateName: name })
            }
          />
        </>
      )}

      {at === "pause_campaign_sequence" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
          />
          <p className="text-xs text-muted-foreground">
            Cancela todas as mensagens agendadas do lead nesta campanha.
          </p>
        </>
      )}

      {at === "resume_campaign_sequence" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
          />
          <p className="text-xs text-muted-foreground">
            Reagenda as mensagens canceladas do lead nesta campanha.
          </p>
        </>
      )}

      {/* ═══════ AGENDA ═══════ */}

      {at === "create_calendar_event" && (
        <>
          <div className="space-y-2">
            <Label>Título do Evento</Label>
            <Input
              value={data.eventTitle || ""}
              onChange={(e) => onUpdate({ eventTitle: e.target.value })}
              placeholder="Reunião com {{nome}}"
            />
          </div>
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={data.eventDescription || ""}
              onChange={(e) => onUpdate({ eventDescription: e.target.value })}
              placeholder="Detalhes do evento"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Duração (minutos)</Label>
            <Input
              type="number"
              min={15}
              step={15}
              value={data.eventDurationMinutes ?? 30}
              onChange={(e) =>
                onUpdate({ eventDurationMinutes: Number(e.target.value) })
              }
            />
          </div>
        </>
      )}

      {at === "schedule_meeting" && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Cria uma entrada no funil {nomeConfirmacao} com status "reunião
          marcada" para o lead.
        </div>
      )}

      {/* ═══════ TINYERP ═══════ */}

      {(at === "create_tinyerp_order" ||
        at === "create_tinyerp_upsell_order") && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Cria automaticamente um pedido no TinyERP usando os dados da
          proposta/upsell do lead. Requer integração TinyERP configurada.
        </div>
      )}

      {/* ═══════ EQUIPE ═══════ */}

      {/* `assign_sale_responsible` saiu da lista: o tipo nunca existiu em
          `WorkflowActionType`, então a comparação era morta — TS2367 mascarado
          no baseline pelo TEXTO do erro, que carrega a união inteira e mudou de
          nome quando as ações de Negócio entraram. Tirar o ramo morto é o
          conserto; regenerar o baseline só teria escondido de novo. */}
      {(at === "assign_responsible" || at === "assign_sdr" || at === "assign_closer") && (
        <AssignResponsibleConfig data={data} onUpdate={onUpdate} />
      )}

      {at === "notify_team_member" && (
        <>
          <div className="space-y-2">
            <Label>Nome do Membro</Label>
            <Input
              value={data.notifyMemberName || ""}
              onChange={(e) => onUpdate({ notifyMemberName: e.target.value })}
              placeholder="Nome ou ID"
            />
          </div>
          <div className="space-y-2">
            <Label>Mensagem</Label>
            <Textarea
              value={data.notifyMessage || ""}
              onChange={(e) => onUpdate({ notifyMessage: e.target.value })}
              placeholder="Lead {{nome}} precisa de atenção!"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Canal de Notificação</Label>
            <Select
              value={data.notifyChannel || "app"}
              onValueChange={(v) =>
                onUpdate({ notifyChannel: v as "app" | "whatsapp" | "both" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="app">Apenas no App</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="both">App + WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* ═══════ NEGÓCIOS ═══════ */}

      {at === "create_deal" && <CreateDealConfig data={data} onUpdate={onUpdate} />}

      {/* Ganhar e perder não têm configuração de destino, e agora por um motivo
          diferente: NÃO EXISTE destino. O desfecho é campo do negócio
          (`deals.outcome`, ADR-0023 Emenda 1) e o card não se move.

          O texto anterior dizia "move o negócio para a etapa de ganho do funil
          dele" — era verdade e deixou de ser. Descrever o comportamento velho
          numa tela de configuração é pior que não descrever nada: o usuário
          monta o workflow esperando o card mudar de coluna. */}
      {(at === "win_deal" || at === "lose_deal") && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">
          {at === "win_deal"
            ? "Marca o negócio como ganho, na etapa em que ele estiver."
            : "Marca o negócio como perdido, na etapa em que ele estiver."}
          {" "}O card não muda de coluna. Exige um gatilho de funil — é dele que
          vem qual negócio encerrar.
        </p>
      )}

      {at === "lose_deal" && (
        <div className="space-y-2">
          <Label>Motivo da perda (opcional)</Label>
          <Input
            value={data.lossReason || ""}
            onChange={(e) => onUpdate({ lossReason: e.target.value })}
            placeholder="Preço, prazo, comprou do concorrente…"
          />
        </div>
      )}

      {at === "set_deal_value" && (
        <div className="space-y-2">
          <Label>Valor (R$)</Label>
          <Input
            type="number"
            min={0}
            value={data.dealValue ?? ""}
            // `Number(...)` e não a string crua: `dealValue` é numérico no
            // contrato do nó, e um campo de dinheiro guardado como texto é como
            // "1.500" chega ao banco valendo 1,5.
            onChange={(e) => onUpdate({ dealValue: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="0"
          />
          <p className="text-[11px] text-muted-foreground">
            Grava em <code>deals.value</code>. Negócio sem registro em Negócios não aceita valor.
          </p>
        </div>
      )}

      {at === "set_deal_owner" && <SetDealOwnerConfig data={data} onUpdate={onUpdate} />}

      {/* ═══════ FOLLOW-UP ═══════ */}

      {at === "create_followup" && (
        <>
          <div className="space-y-2">
            <Label>Título</Label>
            <Input
              value={data.followupTitle || ""}
              onChange={(e) => onUpdate({ followupTitle: e.target.value })}
              placeholder="Ex: Fazer follow-up com lead"
            />
          </div>
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={data.followupDescription || ""}
              onChange={(e) =>
                onUpdate({ followupDescription: e.target.value })
              }
              placeholder="Detalhes do follow-up"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select
              value={data.followupPriority || "medium"}
              onValueChange={(v) =>
                onUpdate({
                  followupPriority: v as "low" | "medium" | "high",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* ═══════ IA ═══════ */}

      {at === "generate_ai_message" && (
        <>
          <div className="space-y-2">
            <Label>Prompt para a IA</Label>
            <Textarea
              value={data.aiPrompt || ""}
              onChange={(e) => onUpdate({ aiPrompt: e.target.value })}
              placeholder="Gere uma mensagem de follow-up para {{nome}} da {{empresa}} considerando que..."
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Salvar resultado em variável</Label>
            <Input
              value={data.aiOutputVariable || "ai_message"}
              onChange={(e) => onUpdate({ aiOutputVariable: e.target.value })}
              placeholder="ai_message"
            />
            <p className="text-xs text-muted-foreground">
              Use {"{{ai_message}}"} em nós seguintes para usar o texto gerado.
            </p>
          </div>
        </>
      )}

      {at === "summarize_conversation" && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-700 dark:text-green-300">
            Resume automaticamente o histórico de conversa do lead e salva no
            contexto do workflow. Útil antes de um handoff para Copilot ou para
            enriquecer notificações.
          </p>
        </div>
      )}

      {at === "evaluate_conversation" && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-700 dark:text-green-300">
            Avalia a qualidade da conversa com IA: tom, engajamento,
            qualificação. O resultado fica disponível nas condições seguintes.
          </p>
        </div>
      )}

      {at === "apply_checklist" && (
        <ApplyChecklistConfig data={data} onUpdate={onUpdate} />
      )}

      {at === "mark_checklist_item" && (
        <MarkChecklistItemConfig data={data} onUpdate={onUpdate} />
      )}
    </div>
  );
}

// ── Move Stage (com seletor dinâmico de etapas) ───────────────────────────────

// SCRUM-627: o seletor opera por FUNIL REAL — a lista de `pipelines` da org,
// um grupo só (sistema + custom), gravando sempre `pipelineId` (uuid). O
// fallback silencioso "whatsapp" morreu: nó sem funil escolhido não carrega
// etapa nenhuma. `pipeType` sobrevive só como LEITURA legada (slug de sistema
// OU uuid custom dos nós salvos) e é zerado na primeira troca.
// (SCRUM-618: upsell_* fora — Carteira não é funil.)
function MoveStageFields({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  // `useFunisDaOrg`: o rótulo tem que ser o nome que a org usa, não o seed.
  const { data: pipelines, isLoading: pipelinesLoading } = useFunisDaOrg();

  const legacyRef = (data.pipeType as string) || "";
  const pipelineId =
    ((data.pipelineId as string) || "") ||
    (legacyRef
      ? pipelines?.find((p) => p.id === legacyRef || p.slug === legacyRef)?.id ?? ""
      : "");

  const funis = (pipelines ?? []).filter((p) => p.is_active !== false);

  const { etapas, isLoading: stagesLoading } = useEtapasDoFunil(pipelineId || null);
  const activeStages = etapas.map((e) => ({
    key: e.stageKey,
    name: e.label,
    color: "#888",
  }));

  const handlePipeChange = (value: string) => {
    onUpdate({ pipelineId: value, pipeType: "", targetStage: "" });
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Funil</Label>
        <Select value={pipelineId} onValueChange={handlePipeChange}>
          <SelectTrigger>
            <SelectValue placeholder={pipelinesLoading ? "Carregando funis..." : "Selecione o funil"} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Funis
              </SelectLabel>
              {funis.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Estágio destino</Label>
        {stagesLoading ? (
          <p className="text-xs text-muted-foreground">Carregando estágios...</p>
        ) : (
          <Select
            value={data.targetStage || ""}
            onValueChange={(v) => onUpdate({ targetStage: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o estágio" />
            </SelectTrigger>
            <SelectContent>
              {activeStages.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </>
  );
}

// ── Tag Selector ──────────────────────────────────────────────────────────────

function TagSelectorField({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: tags, isLoading, isError } = useTags();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Tag</Label>
        <p className="text-xs text-muted-foreground">Carregando tags...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <Label>Tag</Label>
        <p className="text-xs text-destructive">Erro ao carregar tags.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Tag</Label>
      {(tags ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma tag cadastrada na organização.
        </p>
      ) : (
        <Select
          value={data.tagId || ""}
          onValueChange={(v) => {
            const selected = tags?.find((t) => t.id === v);
            onUpdate({
              tagId: v,
              tagName: selected?.name || "",
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a tag" />
          </SelectTrigger>
          <SelectContent>
            {(tags ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.color || "#888" }}
                  />
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// ── WhatsApp Texto ────────────────────────────────────────────────────────────

// ── Unified "Enviar Mensagem" node (ADR-0012) ─────────────────────────────────

const MESSAGE_TYPE_OPTIONS: { value: MessageType; label: string }[] = [
  { value: "texto", label: "Texto" },
  { value: "imagem", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "audio", label: "Áudio" },
  { value: "sticker", label: "Sticker" },
  { value: "menu", label: "Menu" },
  { value: "pix", label: "Botão PIX" },
];

function UnifiedMessagePanel({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const mt: MessageType = (data.messageType as MessageType) || "texto";

  return (
    <>
      <div className="space-y-2">
        <Label>Tipo de mensagem</Label>
        <Select
          value={mt}
          onValueChange={(v) => onUpdate({ messageType: v as MessageType })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o tipo" />
          </SelectTrigger>
          <SelectContent>
            {MESSAGE_TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mt === "texto" && <WhatsAppTextPanel data={data} onUpdate={onUpdate} aiMode />}
      {mt === "imagem" && <WhatsAppImagePanel data={data} onUpdate={onUpdate} />}
      {mt === "video" && <WhatsAppVideoPanel data={data} onUpdate={onUpdate} />}
      {mt === "audio" && <WhatsAppAudioPanel data={data} onUpdate={onUpdate} />}
      {mt === "sticker" && (
        <div className="space-y-2">
          <Label>URL da Figurinha</Label>
          <Input
            value={data.stickerUrl || ""}
            onChange={(e) => onUpdate({ stickerUrl: e.target.value })}
            placeholder="https://... (PNG ou WebP, idealmente 512x512)"
          />
          <p className="text-xs text-muted-foreground">
            Imagem PNG ou WebP. Recomendado 512×512px com fundo transparente.
          </p>
        </div>
      )}
      {mt === "menu" && <MenuNodeConfig data={data} onUpdate={onUpdate} />}
      {mt === "pix" && <PixButtonNodeConfig data={data} onUpdate={onUpdate} />}

      {/* Semi-automático — aplica à mensagem inteira (ADR-0012) */}
      <div className="flex items-center justify-between rounded-lg border p-3 mt-2">
        <div className="space-y-0.5 pr-2">
          <Label className="text-sm">Semi-automático</Label>
          <p className="text-xs text-muted-foreground">
            Exige aprovação do SDR antes de enviar.
          </p>
        </div>
        <Switch
          checked={!!data.semiAutomatic}
          onCheckedChange={(v) => onUpdate({ semiAutomatic: v })}
        />
      </div>
    </>
  );
}

function WhatsAppTextPanel({
  data,
  onUpdate,
  aiMode = false,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
  /** Unified node (ADR-0012): replaces "Template Meta" mode with "Gerar com IA". */
  aiMode?: boolean;
}) {
  const taRef = useRef<TemplateTextareaHandle>(null);

  // A derivação mora em `@/contracts/workflows/modo-de-mensagem`, junto com a
  // do validador — e presa à do executor por teste gêmeo. Antes havia uma cópia
  // aqui, e o executor não tinha nenhuma: era ele quem ignorava o modo.
  const templateMode = modoDeMensagemDoNo(data as unknown as Record<string, unknown>);

  const { data: templates, isLoading: templatesLoading, isError: templatesError } =
    useCampaignTemplatesByType("text");
  const [templateSearch, setTemplateSearch] = useState("");

  const filteredTemplates = (templates ?? []).filter(
    (t) =>
      !templateSearch ||
      t.name.toLowerCase().includes(templateSearch.toLowerCase()),
  );

  const handleModeChange = (mode: "free" | "campaign_template" | "meta_template" | "ai") => {
    onUpdate({ templateMode: mode, useTemplate: mode === "meta_template" });
  };

  const handleSelectTemplate = (t: CampaignTemplate) => {
    onUpdate({
      messageTemplate: t.content,
      templateSourceId: t.id,
      templateMode: "campaign_template",
      useTemplate: false,
    });
  };

  return (
    <>
      {/* 3-way mode selector */}
      <div className="space-y-1.5">
        <Label>Modo de mensagem</Label>
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
          {(
            aiMode
              ? ([
                  { mode: "free", label: "Escrever" },
                  { mode: "campaign_template", label: "Template" },
                  { mode: "ai", label: "Gerar com IA" },
                ] as const)
              : ([
                  { mode: "free", label: "Escrever" },
                  { mode: "campaign_template", label: "Template" },
                  { mode: "meta_template", label: "Template Meta" },
                ] as const)
          ).map(({ mode, label }) => (
            <Button
              key={mode}
              type="button"
              variant={templateMode === mode ? "default" : "ghost"}
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={() => handleModeChange(mode)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/*
        Modo Template Meta — o MESMO painel do escape de janela, apontado para o
        outro conjunto de campos (`CAMPOS_DO_NO_DE_TEMPLATE`).

        O que havia aqui era um campo de texto livre "ID do Template Meta", que
        gravava `templateId` e não era lido por handler nenhum: o nó falhava com
        "Empty message template" porque este mesmo bloco escondia o campo de
        mensagem. Reusar o painel — em vez de reconstruir um seletor — é o que
        dá de graça a listagem dos aprovados, o mapa de variáveis por posição, a
        mídia do cabeçalho e a prévia, tudo já testado.
      */}
      {templateMode === "meta_template" && (
        <TemplateNodeConfig
          data={data}
          onUpdate={onUpdate}
          campos={CAMPOS_DO_NO_DE_TEMPLATE}
        />
      )}

      {/* Gerar com IA mode (ADR-0012) — prompt gera em variável, node envia */}
      {templateMode === "ai" && (
        <div className="space-y-2">
          <Label>Prompt para a IA</Label>
          <Textarea
            value={data.aiPrompt || ""}
            onChange={(e) => onUpdate({ aiPrompt: e.target.value })}
            placeholder="Gere uma mensagem de follow-up para {{nome}} da {{empresa}} considerando que..."
            rows={3}
          />
          <Label>Salvar resultado em variável</Label>
          <Input
            value={data.aiOutputVariable || "ai_message"}
            onChange={(e) => onUpdate({ aiOutputVariable: e.target.value })}
            placeholder="ai_message"
          />
          <p className="text-xs text-muted-foreground">
            Use {"{{ai_message}}"} na mensagem abaixo para inserir o texto gerado.
          </p>
        </div>
      )}

      {/* Campaign template selector */}
      {templateMode === "campaign_template" && (
        <div className="space-y-2">
          <Label>Selecionar template de texto</Label>
          {templatesError ? (
            <p className="text-xs text-destructive">
              Erro ao carregar templates. Verifique sua conexão.
            </p>
          ) : templatesLoading ? (
            <p className="text-xs text-muted-foreground">
              Carregando templates...
            </p>
          ) : (
            <div className="space-y-2">
              <Input
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Buscar template..."
                className="h-8 text-sm"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border space-y-0.5 p-1 bg-background">
                {filteredTemplates.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {(templates ?? []).length === 0
                      ? "Nenhum template de texto cadastrado em Campanhas"
                      : "Nenhum resultado"}
                  </p>
                ) : (
                  filteredTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectTemplate(t)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-muted transition-colors",
                        data.templateSourceId === t.id &&
                          "bg-primary/10 text-primary",
                      )}
                    >
                      <div className="font-medium truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.content}
                      </div>
                    </button>
                  ))
                )}
              </div>
              {data.templateSourceId && (
                <p className="text-xs text-primary">
                  Template carregado. Edite o conteúdo abaixo se necessário.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Message textarea (free + campaign_template modes) */}
      {templateMode !== "meta_template" && (
        <div className="space-y-2">
          <Label>
            {templateMode === "campaign_template"
              ? "Conteúdo (editável)"
              : "Mensagem"}
          </Label>
          <VariableInserter
            onInsert={(v) => taRef.current?.insertAtCursor(v)}
          />
          <TemplateTextarea
            ref={taRef}
            value={data.messageTemplate || ""}
            onChange={(v) => onUpdate({ messageTemplate: v })}
            placeholder="Olá {{nome}}, tudo bem?"
            rows={4}
          />
        </div>
      )}

      {/*
        Escape de janela — só aparece quando o nó nomeia o canal oficial (#1689),
        e só no modo TEXTO. No modo template o nó já manda a forma aprovada, que
        é justamente o que a Meta aceita com a janela fechada: oferecer um
        "template para quando a janela fechar" ali seria pedir ao operador que
        configurasse duas vezes a mesma coisa, e o executor ignora o segundo.
      */}
      {templateMode !== "meta_template" && (
        <EscapeDeJanelaConfig data={data} onUpdate={onUpdate} />
      )}
    </>
  );
}

// ── WhatsApp Imagem (Upload) ─────────────────────────────────────────────────

function WhatsAppImagePanel({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { organizationId } = useOrganization();
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const { validateWorkflowImageFile, buildWorkflowAssetPath } = await import(
        "@/lib/workflow-image-upload"
      );

      const validation = validateWorkflowImageFile(file);
      if (!validation.valid) {
        toast.error(validation.error!);
        return;
      }
      if (!organizationId) {
        toast.error("Organização não encontrada");
        return;
      }

      setIsUploading(true);
      try {
        const path = buildWorkflowAssetPath(organizationId, file.name);
        const { data: uploaded, error } = await supabase.storage
          .from("media")
          .upload(path, file, { contentType: file.type, upsert: false });

        if (error) throw new Error(error.message);

        const { data: urlData } = supabase.storage
          .from("media")
          .getPublicUrl(uploaded.path);

        if (!urlData?.publicUrl) throw new Error("Erro ao obter URL da imagem");

        onUpdate({ imageUrl: urlData.publicUrl });
        toast.success("Imagem enviada!");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erro ao enviar imagem";
        toast.error(message);
      } finally {
        setIsUploading(false);
      }
    },
    [organizationId, onUpdate],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const removeImage = () => {
    onUpdate({ imageUrl: undefined });
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Imagem</Label>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={handleInputChange}
        />

        {data.imageUrl ? (
          <div className="relative group rounded-lg border overflow-hidden bg-muted/30">
            <img
              src={data.imageUrl}
              alt="Preview"
              className="w-full max-h-40 object-contain"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                Trocar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={removeImage}
                disabled={isUploading}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              isUploading && "pointer-events-none opacity-60",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground text-center">
              {isUploading
                ? "Enviando..."
                : "Clique ou arraste uma imagem aqui"}
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              JPG, PNG, GIF ou WebP — máx. 16MB
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Legenda (opcional)</Label>
        <Textarea
          value={data.imageCaption || ""}
          onChange={(e) => onUpdate({ imageCaption: e.target.value })}
          placeholder="Confira nosso catálogo, {{nome}}!"
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Variáveis: {"{{"} nome {"}}"}, {"{{"} empresa {"}}"} ...
        </p>
      </div>
    </>
  );
}

function WhatsAppVideoPanel({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { organizationId } = useOrganization();
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const { validateWorkflowVideoFile, buildWorkflowAssetPath } = await import(
        "@/lib/workflow-image-upload"
      );

      const validation = validateWorkflowVideoFile(file);
      if (!validation.valid) {
        toast.error(validation.error!);
        return;
      }
      if (!organizationId) {
        toast.error("Organização não encontrada");
        return;
      }

      setIsUploading(true);
      try {
        const path = buildWorkflowAssetPath(organizationId, file.name);
        const { data: uploaded, error } = await supabase.storage
          .from("media")
          .upload(path, file, {
            // Always mp4 — the validator rejects everything else, so we never
            // want an empty browser type to reach the bucket's mime allowlist.
            contentType: "video/mp4",
            upsert: false,
          });

        if (error) throw new Error(error.message);

        const { data: urlData } = supabase.storage
          .from("media")
          .getPublicUrl(uploaded.path);

        if (!urlData?.publicUrl) throw new Error("Erro ao obter URL do vídeo");

        onUpdate({ videoUrl: urlData.publicUrl, videoMode: "upload" });
        toast.success("Vídeo enviado!");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erro ao enviar vídeo";
        toast.error(message);
      } finally {
        setIsUploading(false);
      }
    },
    [organizationId, onUpdate],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const removeVideo = () => {
    onUpdate({ videoUrl: undefined });
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Vídeo</Label>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,.mp4"
          className="hidden"
          onChange={handleInputChange}
        />

        {data.videoUrl ? (
          <div className="relative group rounded-lg border overflow-hidden bg-muted/30">
            <video
              src={data.videoUrl}
              controls
              preload="metadata"
              className="w-full max-h-40 object-contain"
            />
            <div className="absolute inset-x-0 top-0 flex justify-end gap-2 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                Trocar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={removeVideo}
                disabled={isUploading}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              isUploading && "pointer-events-none opacity-60",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground text-center">
              {isUploading ? "Enviando..." : "Clique ou arraste um vídeo aqui"}
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              MP4 apenas — máx. 16MB
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Legenda (opcional)</Label>
        <Textarea
          value={data.videoCaption || ""}
          onChange={(e) => onUpdate({ videoCaption: e.target.value })}
          placeholder="Olha esse vídeo, {{nome}}!"
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Variáveis: {"{{"} nome {"}}"}, {"{{"} empresa {"}}"} ...
        </p>
      </div>
    </>
  );
}

function WhatsAppDocumentPanel({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { organizationId } = useOrganization();
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const { validateWorkflowDocumentFile, buildWorkflowAssetPath } = await import(
        "@/lib/workflow-image-upload"
      );

      const validation = validateWorkflowDocumentFile(file);
      if (!validation.valid) {
        toast.error(validation.error!);
        return;
      }
      if (!organizationId) {
        toast.error("Organização não encontrada");
        return;
      }

      setIsUploading(true);
      try {
        const path = buildWorkflowAssetPath(organizationId, file.name);
        const { data: uploaded, error } = await supabase.storage
          .from("media")
          .upload(path, file, {
            contentType: file.type || "application/pdf",
            upsert: false,
          });

        if (error) throw new Error(error.message);

        const { data: urlData } = supabase.storage
          .from("media")
          .getPublicUrl(uploaded.path);

        if (!urlData?.publicUrl) throw new Error("Erro ao obter URL do documento");

        onUpdate({ documentUrl: urlData.publicUrl, documentName: file.name });
        toast.success("Documento enviado!");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erro ao enviar documento";
        toast.error(message);
      } finally {
        setIsUploading(false);
      }
    },
    [organizationId, onUpdate],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const removeDocument = () => {
    onUpdate({ documentUrl: undefined, documentName: undefined });
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Documento</Label>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf"
          className="hidden"
          onChange={handleInputChange}
        />

        {data.documentUrl ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {data.documentName || "Documento"}
              </p>
              <p className="text-[10px] text-muted-foreground">Pronto para envio</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                Trocar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={removeDocument}
                disabled={isUploading}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              isUploading && "pointer-events-none opacity-60",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground text-center">
              {isUploading ? "Enviando..." : "Clique ou arraste um documento aqui"}
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              PDF, DOC, XLS, PPT, TXT ou CSV — máx. 16MB
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Legenda (opcional)</Label>
        <Textarea
          value={data.documentCaption || ""}
          onChange={(e) => onUpdate({ documentCaption: e.target.value })}
          placeholder="Segue a proposta, {{nome}}!"
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Variáveis: {"{{"} nome {"}}"}, {"{{"} empresa {"}}"} ...
        </p>
      </div>
    </>
  );
}

// ── WhatsApp Áudio ────────────────────────────────────────────────────────────

function WhatsAppAudioPanel({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const audioMode = (data.audioMode as string) || "recorded";

  return (
    <>
      {/* Mode toggle */}
      <div className="space-y-1.5">
        <Label>Modo do áudio</Label>
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
          <Button
            type="button"
            variant={audioMode === "recorded" ? "default" : "ghost"}
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={() => onUpdate({ audioMode: "recorded" })}
          >
            Gravar novo
          </Button>
          <Button
            type="button"
            variant={audioMode === "template" ? "default" : "ghost"}
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={() => onUpdate({ audioMode: "template" })}
          >
            Usar template de áudio
          </Button>
        </div>
      </div>

      {audioMode === "template" ? (
        <AudioTemplatePicker
          selectedId={data.audioSourceId}
          onSelect={(t) =>
            onUpdate({
              audioUrl: t.audio_url ?? undefined,
              audioName: t.name,
              audioSourceId: t.id,
              audioMode: "template",
            })
          }
        />
      ) : (
        <AudioRecorderField
          audioUrl={data.audioUrl}
          audioName={data.audioName}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}

// ── Seletor de template de áudio ─────────────────────────────────────────────

function AudioTemplatePicker({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (template: CampaignTemplate) => void;
}) {
  const { data: templates, isLoading, isError } = useCampaignTemplatesByType("audio");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const filtered = (templates ?? []).filter(
    (t) =>
      !search || t.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = (t: CampaignTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingId === t.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    if (!t.audio_url) return;
    const audio = new Audio(t.audio_url);
    audioRef.current = audio;
    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };
    audio.play();
    setPlayingId(t.id);
  };

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground">
        Carregando templates de áudio...
      </p>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive">
        Erro ao carregar templates de áudio.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Template de áudio</Label>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar template..."
        className="h-8 text-sm"
      />
      <div className="max-h-48 overflow-y-auto rounded-md border space-y-0.5 p-1 bg-background">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            {(templates ?? []).length === 0
              ? "Nenhum template de áudio cadastrado em Campanhas"
              : "Nenhum resultado"}
          </p>
        ) : (
          filtered.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2 p-2 rounded-sm hover:bg-muted cursor-pointer transition-colors",
                selectedId === t.id &&
                  "bg-primary/10 border border-primary/30",
              )}
              onClick={() => onSelect(t)}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={(e) => togglePlay(t, e)}
                disabled={!t.audio_url}
                title={playingId === t.id ? "Parar" : "Ouvir"}
              >
                {playingId === t.id ? (
                  <Square className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </Button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.name}</div>
              </div>
              {selectedId === t.id && (
                <Badge variant="secondary" className="text-xs flex-shrink-0">
                  Selecionado
                </Badge>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Gravador de áudio para ação WhatsApp ──────────────────────────────────────

function AudioRecorderField({
  audioUrl,
  audioName,
  onUpdate,
}: {
  audioUrl?: string;
  audioName?: string;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { organizationId } = useOrganization();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [localBlob, setLocalBlob] = useState<Blob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    preloadLamejs();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
    };
  }, []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported(mimeType))
          mimeType = "audio/ogg;codecs=opus";
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";
      }
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        setLocalBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(
        () => setRecordingTime((s) => s + 1),
        1000,
      );
    } catch (err) {
      console.error("[ActionPanel AudioRecorder] getUserMedia failed:", err);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") {
        toast.error("Permissão do microfone bloqueada. Clique no cadeado na barra de endereço e permita o acesso.", { duration: 8000 });
      } else if (name === "NotFoundError") {
        toast.error("Nenhum microfone encontrado.");
      } else if (name === "NotReadableError") {
        toast.error("Microfone em uso por outro aplicativo.");
      } else {
        toast.error("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const uploadAudio = useCallback(
    async (blob: Blob) => {
      if (!organizationId) {
        toast.error("Organização não encontrada");
        return;
      }
      setIsUploading(true);
      try {
        const mp3Blob = await convertAudioBlobToMp3(blob);
        const ext = mp3Blob.type.includes("mpeg")
          ? "mp3"
          : mp3Blob.type.includes("ogg")
            ? "ogg"
            : "webm";
        const path = `workflow-audios/${organizationId}/${crypto.randomUUID()}.${ext}`;

        const { data, error } = await supabase.storage
          .from("media")
          .upload(path, mp3Blob, {
            contentType: mp3Blob.type || "audio/mpeg",
            upsert: false,
          });

        if (error) throw new Error(`Erro ao enviar áudio: ${error.message}`);

        const { data: urlData } = supabase.storage
          .from("media")
          .getPublicUrl(data.path);
        if (!urlData?.publicUrl) throw new Error("Erro ao obter URL do áudio");

        onUpdate({
          audioUrl: urlData.publicUrl,
          audioId: undefined,
          audioName: audioName || "Áudio gravado",
          audioMode: "recorded",
          audioSourceId: undefined,
        });
        setLocalBlob(null);
        toast.success("Áudio salvo com sucesso!");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erro ao enviar áudio";
        console.error("Erro ao enviar áudio:", err);
        toast.error(message);
      } finally {
        setIsUploading(false);
      }
    },
    [organizationId, onUpdate, audioName],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("audio/")) {
      setLocalBlob(file);
    } else if (file) {
      toast.error("Selecione um arquivo de áudio (mp3, ogg, webm, etc.)");
    }
    e.target.value = "";
  };

  const removeAudio = () => {
    setLocalBlob(null);
    onUpdate({
      audioUrl: undefined,
      audioId: undefined,
      audioName: undefined,
      audioSourceId: undefined,
    });
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
      setIsPlaying(false);
    }
  };

  const togglePlayback = () => {
    const url = audioUrl || (localBlob ? URL.createObjectURL(localBlob) : null);
    if (!url) return;

    if (isPlaying && audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(url);
    audioElRef.current = audio;
    audio.onended = () => {
      setIsPlaying(false);
      audioElRef.current = null;
    };
    audio.play();
    setIsPlaying(true);
  };

  const hasAudio = !!audioUrl;
  const hasPendingBlob = !!localBlob && !audioUrl;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Nome do Áudio (referência)</Label>
        <Input
          value={audioName || ""}
          onChange={(e) => onUpdate({ audioName: e.target.value })}
          placeholder="Ex: Apresentação inicial"
        />
      </div>

      <Card className="bg-muted/30 border-primary/20">
        <CardContent className="p-4 space-y-3">
          {/* State: no audio, no pending blob — show record/upload buttons */}
          {!hasAudio && !hasPendingBlob && !isRecording && (
            <>
              <p className="text-sm text-muted-foreground">
                Grave ou envie um áudio que será enviado automaticamente ao
                lead.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={startRecording}
                >
                  <Mic className="w-4 h-4 mr-1" />
                  Gravar áudio
                </Button>
                <Label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-md border bg-background hover:bg-muted/50 text-sm">
                  <Upload className="w-4 h-4" />
                  Enviar arquivo
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </Label>
              </div>
            </>
          )}

          {/* State: recording in progress */}
          {isRecording && (
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
              <span className="text-sm font-medium text-red-600">
                Gravando... {formatTime(recordingTime)}
              </span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={stopRecording}
              >
                <MicOff className="w-4 h-4 mr-1" />
                Parar
              </Button>
            </div>
          )}

          {/* State: blob recorded/uploaded but not yet saved to storage */}
          {hasPendingBlob && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={togglePlayback}
                  >
                    {isPlaying ? (
                      <Square className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                  <span className="text-sm">
                    Áudio pronto · {(localBlob.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocalBlob(null)}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Remover
                </Button>
              </div>
              <Button
                type="button"
                className="w-full"
                onClick={() => uploadAudio(localBlob)}
                disabled={isUploading}
              >
                {isUploading ? "Salvando áudio..." : "Salvar áudio no workflow"}
              </Button>
            </div>
          )}

          {/* State: audio already saved (URL exists) */}
          {hasAudio && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={togglePlayback}
                >
                  {isPlaying ? (
                    <Square className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
                <span className="text-sm text-green-700 dark:text-green-400">
                  Áudio salvo
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeAudio}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Remover
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
