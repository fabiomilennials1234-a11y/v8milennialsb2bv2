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
import { Mic, MicOff, Upload, Trash2, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION_CATEGORIES, ACTION_LABELS } from "@/types/workflow";
import type { ActionNodeData, WorkflowActionType } from "@/types/workflow";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { useOrganization } from "@/hooks/useOrganization";
import { useCampaignTemplatesByType } from "@/hooks/useCampaignTemplates";
import { supabase } from "@/integrations/supabase/client";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { convertAudioBlobToMp3, preloadLamejs } from "@/lib/audioToMp3";
import { toast } from "sonner";
import { VariableInserter } from "@/components/automacoes/VariableInserter";
import {
  TemplateTextarea,
  type TemplateTextareaHandle,
} from "@/components/automacoes/TemplateTextarea";
import type { CampaignTemplate } from "@/hooks/useCampaignTemplates";
import { usePipelineStages, type PipelineType } from "@/hooks/usePipelineStages";
import { useCustomPipelines, useCustomPipelineStages } from "@/hooks/useCustomPipelines";
import { useTags } from "@/hooks/useTags";
import { CampaignSelectorField } from "./CampaignSelectorField";
import { CampaignStageSelectorField } from "./CampaignStageSelectorField";
import { CampaignTemplateSelectorField } from "./CampaignTemplateSelectorField";
import { useChecklistTemplates } from "@/hooks/useChecklistTemplates";

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

interface ActionPanelProps {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}

export function ActionPanel({ data, onUpdate }: ActionPanelProps) {
  const at = data.actionType;

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
            {ACTION_CATEGORIES.map((cat) => (
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
      {(at === "send_whatsapp" ||
        at === "send_whatsapp_audio" ||
        at === "send_whatsapp_image" ||
        at === "send_whatsapp_template") && (
        <WhatsAppInstanceSelector
          instanceId={data.whatsappInstanceId}
          onSelect={(id, name) =>
            onUpdate({ whatsappInstanceId: id, whatsappInstanceName: name })
          }
        />
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
        <>
          <div className="space-y-2">
            <Label>URL da Imagem</Label>
            <Input
              value={data.imageUrl || ""}
              onChange={(e) => onUpdate({ imageUrl: e.target.value })}
              placeholder="https://..."
            />
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
      )}

      {/* Send WhatsApp Template */}
      {at === "send_whatsapp_template" && (
        <div className="space-y-2">
          <Label>ID do Template</Label>
          <Input
            value={data.templateId || ""}
            onChange={(e) => onUpdate({ templateId: e.target.value })}
            placeholder="ID do template aprovado"
          />
          <p className="text-xs text-muted-foreground">
            Templates aprovados pela Meta para envio em massa
          </p>
        </div>
      )}

      {/* Send Meta Message */}
      {at === "send_meta_message" && (
        <>
          <div className="space-y-2">
            <Label>Canal</Label>
            <Select
              value={data.metaChannel || "instagram"}
              onValueChange={(v) =>
                onUpdate({ metaChannel: v as "instagram" | "facebook" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Mensagem</Label>
            <Textarea
              value={data.metaMessage || ""}
              onChange={(e) => onUpdate({ metaMessage: e.target.value })}
              placeholder="Olá {{nome}}!"
              rows={3}
            />
          </div>
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
                <SelectItem value="pipe_whatsapp">Qualificação</SelectItem>
                <SelectItem value="pipe_confirmacao">Confirmação</SelectItem>
                <SelectItem value="pipe_propostas">Propostas</SelectItem>
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
              <SelectItem value="pipe_whatsapp">Qualificação</SelectItem>
              <SelectItem value="pipe_confirmacao">Confirmação</SelectItem>
              <SelectItem value="pipe_propostas">Propostas</SelectItem>
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
                <SelectItem value="pipe_whatsapp">Qualificação</SelectItem>
                <SelectItem value="pipe_confirmacao">Confirmação</SelectItem>
                <SelectItem value="pipe_propostas">Propostas</SelectItem>
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
          Cria uma entrada no Pipe Confirmação com status "reunião marcada" para
          o lead.
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
    </div>
  );
}

// ── Move Stage (com seletor dinâmico de etapas) ───────────────────────────────

const PIPE_OPTIONS: { value: PipelineType; label: string }[] = [
  { value: "whatsapp", label: "Qualificação" },
  { value: "confirmacao", label: "Confirmação" },
  { value: "propostas", label: "Propostas" },
  { value: "upsell_base", label: "Upsell (Tempo)" },
  { value: "upsell_gestao", label: "Upsell (Gestão)" },
];

function MoveStageFields({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const pipeType = (data.pipeType as string) || "whatsapp";
  const isCustomPipe = !PIPE_OPTIONS.some((p) => p.value === pipeType);

  // Standard pipeline stages
  const { data: standardStages, isLoading: standardLoading } = usePipelineStages(
    isCustomPipe ? "whatsapp" : (pipeType as PipelineType)
  );
  // Custom pipelines list
  const { data: customPipelines } = useCustomPipelines();
  // Custom pipeline stages
  const { data: customStages, isLoading: customLoading } = useCustomPipelineStages(
    isCustomPipe ? pipeType : undefined
  );

  const stagesLoading = isCustomPipe ? customLoading : standardLoading;
  const activeStages = isCustomPipe
    ? (customStages || []).filter((s) => s.is_active).map((s) => ({
        key: s.id,
        name: s.name,
        color: s.color || "#888",
      }))
    : (standardStages || []).filter((s) => s.is_active).map((s) => ({
        key: s.stage_key,
        name: s.name,
        color: s.color || "#888",
      }));

  const handlePipeChange = (value: string) => {
    onUpdate({ pipeType: value, targetStage: "" });
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Tipo de Pipe</Label>
        <Select value={pipeType} onValueChange={handlePipeChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Pipes Padrão
              </SelectLabel>
              {PIPE_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {customPipelines && customPipelines.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                  Pipes Custom
                </SelectLabel>
                {customPipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
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

function WhatsAppTextPanel({
  data,
  onUpdate,
}: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const taRef = useRef<TemplateTextareaHandle>(null);

  // Backward compat: derive templateMode from legacy useTemplate flag
  const templateMode =
    (data.templateMode as string) ||
    (data.useTemplate ? "meta_template" : "free");

  const { data: templates, isLoading: templatesLoading, isError: templatesError } =
    useCampaignTemplatesByType("text");
  const [templateSearch, setTemplateSearch] = useState("");

  const filteredTemplates = (templates ?? []).filter(
    (t) =>
      !templateSearch ||
      t.name.toLowerCase().includes(templateSearch.toLowerCase()),
  );

  const handleModeChange = (mode: "free" | "campaign_template" | "meta_template") => {
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
            [
              { mode: "free", label: "Escrever" },
              { mode: "campaign_template", label: "Template" },
              { mode: "meta_template", label: "Template Meta" },
            ] as const
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

      {/* Template Meta mode */}
      {templateMode === "meta_template" && (
        <div className="space-y-2">
          <Label>ID do Template Meta</Label>
          <Input
            value={data.templateId || ""}
            onChange={(e) => onUpdate({ templateId: e.target.value })}
            placeholder="ID do template aprovado pela Meta"
          />
          <p className="text-xs text-muted-foreground">
            Templates aprovados pela Meta para envio em massa.
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
    } catch {
      toast.error("Não foi possível acessar o microfone");
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

// ── Seletor de instância WhatsApp ─────────────────────────────────────────────

function WhatsAppInstanceSelector({
  instanceId,
  onSelect,
}: {
  instanceId?: string;
  onSelect: (id: string, name: string) => void;
}) {
  const { data: instances, isLoading } = useWhatsAppInstances();

  const connectedInstances = (instances || []).filter(
    (i) => i.status === "connected" || i.status === "open",
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Instância WhatsApp</Label>
        <p className="text-xs text-muted-foreground">
          Carregando instâncias...
        </p>
      </div>
    );
  }

  if (connectedInstances.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Instância WhatsApp</Label>
        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800">
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            Nenhuma instância WhatsApp conectada. Configure em Configurações
            &gt; WhatsApp.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Instância WhatsApp</Label>
      <Select
        value={instanceId || "__auto__"}
        onValueChange={(v) => {
          if (v === "__auto__") {
            onSelect("", "");
            return;
          }
          const inst = connectedInstances.find((i) => i.id === v);
          onSelect(v, inst?.instance_name || "");
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione a instância" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__auto__">
            Automático (primeira disponível)
          </SelectItem>
          {connectedInstances.map((inst) => (
            <SelectItem key={inst.id} value={inst.id}>
              {inst.instance_name}
              {inst.phone_number ? ` (${inst.phone_number})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {instanceId
          ? "Mensagens serão enviadas por esta instância específica."
          : "O sistema escolherá automaticamente uma instância conectada."}
      </p>
    </div>
  );
}
