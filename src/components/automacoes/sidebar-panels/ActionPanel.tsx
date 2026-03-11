import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { ACTION_CATEGORIES, ACTION_LABELS } from "@/types/workflow";
import type { ActionNodeData, WorkflowActionType } from "@/types/workflow";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { convertAudioBlobToMp3, preloadLamejs } from "@/lib/audioToMp3";
import { toast } from "sonner";

interface ActionPanelProps {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}

const VARIABLES_HELP = 'Variáveis: {{nome}}, {{empresa}}, {{email}}, {{telefone}}, {{estagio}}, {{sdr}}, {{closer}}, {{score}}, {{rating}}, {{custom.campo}}';

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
      {(at === "send_whatsapp" || at === "send_whatsapp_audio" || at === "send_whatsapp_image" || at === "send_whatsapp_template") && (
        <WhatsAppInstanceSelector
          instanceId={data.whatsappInstanceId}
          onSelect={(id, name) => onUpdate({ whatsappInstanceId: id, whatsappInstanceName: name })}
        />
      )}

      {/* Send WhatsApp (Texto) */}
      {at === "send_whatsapp" && (
        <>
          <div className="flex items-center gap-2">
            <Switch
              checked={data.useTemplate || false}
              onCheckedChange={(v) => onUpdate({ useTemplate: v })}
            />
            <Label>Usar template existente</Label>
          </div>
          {data.useTemplate ? (
            <div className="space-y-2">
              <Label>ID do Template</Label>
              <Input
                value={data.templateId || ""}
                onChange={(e) => onUpdate({ templateId: e.target.value })}
                placeholder="ID do template"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={data.messageTemplate || ""}
                onChange={(e) => onUpdate({ messageTemplate: e.target.value })}
                placeholder="Olá {{nome}}, tudo bem?"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">{VARIABLES_HELP}</p>
            </div>
          )}
        </>
      )}

      {/* Send WhatsApp (Áudio) */}
      {at === "send_whatsapp_audio" && (
        <AudioRecorderField
          audioUrl={data.audioUrl}
          audioName={data.audioName}
          onUpdate={onUpdate}
        />
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
            <p className="text-xs text-muted-foreground">{VARIABLES_HELP}</p>
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
              onValueChange={(v) => onUpdate({ metaChannel: v as "instagram" | "facebook" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
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
            <p className="text-xs text-muted-foreground">{VARIABLES_HELP}</p>
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
              O SDR verá esta mensagem como sugestão e poderá editar antes de enviar.
            </p>
          </div>
        </>
      )}

      {/* ═══════ LEAD MANAGEMENT ═══════ */}

      {/* Move Stage */}
      {at === "move_stage" && (
        <>
          <div className="space-y-2">
            <Label>Tipo de Pipe</Label>
            <Select
              value={data.pipeType || ""}
              onValueChange={(v) => onUpdate({ pipeType: v })}
            >
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pipe_whatsapp">Qualificação</SelectItem>
                <SelectItem value="pipe_confirmacao">Confirmação</SelectItem>
                <SelectItem value="pipe_propostas">Propostas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Estágio destino</Label>
            <Input
              value={data.targetStage || ""}
              onChange={(e) => onUpdate({ targetStage: e.target.value })}
              placeholder="Ex: confirmada_no_dia"
            />
          </div>
        </>
      )}

      {/* Add/Remove Tag */}
      {(at === "add_tag" || at === "remove_tag") && (
        <div className="space-y-2">
          <Label>Nome da Tag</Label>
          <Input
            value={data.tagName || ""}
            onChange={(e) => onUpdate({ tagName: e.target.value })}
            placeholder="Ex: qualificado"
          />
        </div>
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
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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
            <p className="text-xs text-muted-foreground">{VARIABLES_HELP}</p>
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
            Chama a IA para calcular o lead score automaticamente com base nos dados do lead e histórico de conversas.
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
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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
        <>
          <div className="space-y-2">
            <Label>Nome da Campanha</Label>
            <Input
              value={data.campaignName || ""}
              onChange={(e) => onUpdate({ campaignName: e.target.value })}
              placeholder="Nome ou ID da campanha"
            />
          </div>
          <div className="space-y-2">
            <Label>ID da Campanha</Label>
            <Input
              value={data.campaignId || ""}
              onChange={(e) => onUpdate({ campaignId: e.target.value })}
              placeholder="UUID da campanha"
            />
          </div>
        </>
      )}

      {at === "remove_from_campaign" && (
        <div className="space-y-2">
          <Label>ID da Campanha</Label>
          <Input
            value={data.campaignId || ""}
            onChange={(e) => onUpdate({ campaignId: e.target.value })}
            placeholder="UUID da campanha"
          />
        </div>
      )}

      {at === "move_campaign_stage" && (
        <>
          <div className="space-y-2">
            <Label>ID da Campanha</Label>
            <Input
              value={data.campaignId || ""}
              onChange={(e) => onUpdate({ campaignId: e.target.value })}
              placeholder="UUID da campanha"
            />
          </div>
          <div className="space-y-2">
            <Label>Nome do estágio destino</Label>
            <Input
              value={data.campaignStageName || ""}
              onChange={(e) => onUpdate({ campaignStageName: e.target.value })}
              placeholder="Ex: Qualificado"
            />
          </div>
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
              onChange={(e) => onUpdate({ eventDurationMinutes: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      {at === "schedule_meeting" && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Cria uma entrada no Pipe Confirmação com status "reunião marcada" para o lead.
        </div>
      )}

      {/* ═══════ TINYERP ═══════ */}

      {(at === "create_tinyerp_order" || at === "create_tinyerp_upsell_order") && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Cria automaticamente um pedido no TinyERP usando os dados da proposta/upsell do lead.
          Requer integração TinyERP configurada.
        </div>
      )}

      {/* ═══════ EQUIPE ═══════ */}

      {(at === "assign_sdr" || at === "assign_closer") && (
        <>
          <div className="space-y-2">
            <Label>Modo de Atribuição</Label>
            <Select
              value={data.assignMode || "round_robin"}
              onValueChange={(v) => onUpdate({ assignMode: v as "specific" | "round_robin" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">Round Robin</SelectItem>
                <SelectItem value="specific">Específico</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.assignMode === "specific" && (
            <div className="space-y-2">
              <Label>Nome do Membro</Label>
              <Input
                value={data.assigneeName || ""}
                onChange={(e) => onUpdate({ assigneeName: e.target.value })}
                placeholder="Nome ou ID do membro"
              />
            </div>
          )}
        </>
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
            <p className="text-xs text-muted-foreground">{VARIABLES_HELP}</p>
          </div>
          <div className="space-y-2">
            <Label>Canal de Notificação</Label>
            <Select
              value={data.notifyChannel || "app"}
              onValueChange={(v) => onUpdate({ notifyChannel: v as "app" | "whatsapp" | "both" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
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
              onChange={(e) => onUpdate({ followupDescription: e.target.value })}
              placeholder="Detalhes do follow-up"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select
              value={data.followupPriority || "medium"}
              onValueChange={(v) => onUpdate({ followupPriority: v as "low" | "medium" | "high" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
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
            <p className="text-xs text-muted-foreground">{VARIABLES_HELP}</p>
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
            Resume automaticamente o histórico de conversa do lead e salva no contexto do workflow.
            Útil antes de um handoff para Copilot ou para enriquecer notificações.
          </p>
        </div>
      )}

      {at === "evaluate_conversation" && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-700 dark:text-green-300">
            Avalia a qualidade da conversa com IA: tom, engajamento, qualificação.
            O resultado fica disponível nas condições seguintes.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Gravador de áudio para ação WhatsApp ──

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

  // Preload lamejs when component mounts
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
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/ogg;codecs=opus";
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
      timerRef.current = setInterval(() => setRecordingTime((s) => s + 1), 1000);
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
        // Convert to MP3 for universal compatibility
        const mp3Blob = await convertAudioBlobToMp3(blob);
        const ext = mp3Blob.type.includes("mpeg") ? "mp3" : mp3Blob.type.includes("ogg") ? "ogg" : "webm";
        const path = `workflow-audios/${organizationId}/${crypto.randomUUID()}.${ext}`;

        const { data, error } = await supabase.storage.from("media").upload(path, mp3Blob, {
          contentType: mp3Blob.type || "audio/mpeg",
          upsert: false,
        });

        if (error) throw new Error(`Erro ao enviar áudio: ${error.message}`);

        const { data: urlData } = supabase.storage.from("media").getPublicUrl(data.path);
        if (!urlData?.publicUrl) throw new Error("Erro ao obter URL do áudio");

        onUpdate({ audioUrl: urlData.publicUrl, audioId: undefined, audioName: audioName || "Áudio gravado" });
        setLocalBlob(null);
        toast.success("Áudio salvo com sucesso!");
      } catch (err: any) {
        console.error("Erro ao enviar áudio:", err);
        toast.error(err?.message || "Erro ao enviar áudio");
      } finally {
        setIsUploading(false);
      }
    },
    [organizationId, onUpdate, audioName]
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
    onUpdate({ audioUrl: undefined, audioId: undefined, audioName: undefined });
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
                Grave ou envie um áudio que será enviado automaticamente ao lead.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="default" size="sm" onClick={startRecording}>
                  <Mic className="w-4 h-4 mr-1" />
                  Gravar áudio
                </Button>
                <Label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-md border bg-background hover:bg-muted/50 text-sm">
                  <Upload className="w-4 h-4" />
                  Enviar arquivo
                  <input type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />
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
              <Button type="button" variant="destructive" size="sm" onClick={stopRecording}>
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
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={togglePlayback}>
                    {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <span className="text-sm">
                    Áudio pronto · {(localBlob.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setLocalBlob(null)}>
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
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={togglePlayback}>
                  {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </Button>
                <span className="text-sm text-green-700 dark:text-green-400">
                  Áudio salvo
                </span>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={removeAudio}>
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

// ── Seletor de instância WhatsApp ──

function WhatsAppInstanceSelector({
  instanceId,
  onSelect,
}: {
  instanceId?: string;
  onSelect: (id: string, name: string) => void;
}) {
  const { data: instances, isLoading } = useWhatsAppInstances();

  const connectedInstances = (instances || []).filter(
    (i) => i.status === "connected" || i.status === "open"
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Instância WhatsApp</Label>
        <p className="text-xs text-muted-foreground">Carregando instâncias...</p>
      </div>
    );
  }

  if (connectedInstances.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Instância WhatsApp</Label>
        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800">
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            Nenhuma instância WhatsApp conectada. Configure em Configurações &gt; WhatsApp.
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
          <SelectItem value="__auto__">Automático (primeira disponível)</SelectItem>
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
