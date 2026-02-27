/**
 * Step 16: Configuração de Outbound
 *
 * Define o delay, template da primeira mensagem, configurações de retry
 * e áudios pré-gravados para abordagem.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { useParams } from "react-router-dom";
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
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Clock,
  RefreshCw,
  Variable,
  Volume2,
  Upload,
  Mic,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { CopilotWizardData, CopilotAgentAudio } from "@/types/copilot";
import {
  useCopilotAgentAudios,
  useUploadCopilotAgentAudio,
  useDeleteCopilotAgentAudio,
} from "@/hooks/useCopilotAgentAudios";

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

const MAX_AUDIOS = 5;
const ACCEPTED_AUDIO_TYPES = ".ogg,.mp3,.m4a,.wav,.webm";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface PendingAudio {
  file: File;
  name: string;
  previewUrl: string;
}

export function OutboundConfigStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const { id: editAgentId } = useParams<{ id: string }>();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const isEditMode = !!editAgentId;

  const template = watch("outboundConfig.firstMessageTemplate") || "";
  const audioEnabled = watch("outboundConfig.audioEnabled") ?? false;
  const audioSendOrder = watch("outboundConfig.audioSendOrder") ?? "text_first";

  // Estado local para áudios pendentes (modo criação — upload acontece no onSubmit)
  const [pendingAudios, setPendingAudios] = useState<PendingAudio[]>([]);

  // Gravação
  const [showRecordDialog, setShowRecordDialog] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hooks de CRUD (modo edição)
  const { data: existingAudios = [] } = useCopilotAgentAudios(editAgentId);
  const uploadAudio = useUploadCopilotAgentAudio();
  const deleteAudio = useDeleteCopilotAgentAudio();

  const activeExistingCount = existingAudios.filter((a) => a.is_active).length;
  const totalAudios = activeExistingCount + pendingAudios.length;
  const canAddMore = totalAudios < MAX_AUDIOS;

  // Sincronizar pendingAudios com o form para o CopilotWizard.onSubmit acessar
  useEffect(() => {
    setValue("_pendingAudioFiles" as any, pendingAudios, { shouldValidate: false });
  }, [pendingAudios, setValue]);

  // Auto-habilitar toggle quando adicionar primeiro áudio
  useEffect(() => {
    if (totalAudios > 0 && !audioEnabled) {
      setValue("outboundConfig.audioEnabled", true, { shouldValidate: true });
    }
  }, [totalAudios, audioEnabled, setValue]);

  const insertVariable = (variable: string) => {
    const currentTemplate = watch("outboundConfig.firstMessageTemplate") || "";
    setValue("outboundConfig.firstMessageTemplate", currentTemplate + variable, {
      shouldValidate: true,
    });
  };

  const previewMessage = template
    .replace("{nome}", "Maria")
    .replace("{empresa}", "Tech Corp")
    .replace("{email}", "maria@techcorp.com")
    .replace("{telefone}", "11999999999")
    .replace("{origem}", "Meta Ads")
    .replace("{interesse}", "CRM com IA")
    .replace("{segmento}", "Tecnologia")
    .replace("{campanha}", "Black Friday 2026");

  // =====================================================
  // Gravação de áudio
  // =====================================================
  const startRecording = useCallback(async () => {
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
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((s) => s + 1), 1000);
    } catch {
      toast.error("Erro ao acessar microfone", {
        description: "Verifique as permissões do navegador.",
      });
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const handleSaveRecording = useCallback(() => {
    if (!audioBlob) return;
    const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([audioBlob], `gravacao_${Date.now()}.${ext}`, {
      type: audioBlob.type,
    });
    const name = audioName.trim() || `Gravação ${new Date().toLocaleDateString("pt-BR")}`;

    if (isEditMode && editAgentId && organizationId) {
      uploadAudio.mutate({
        agentId: editAgentId,
        organizationId,
        file,
        name,
      });
    } else {
      setPendingAudios((prev) => [
        ...prev,
        { file, name, previewUrl: URL.createObjectURL(audioBlob) },
      ]);
    }

    setShowRecordDialog(false);
    setAudioBlob(null);
    setAudioName("");
    setRecordingTime(0);
  }, [audioBlob, audioName, isEditMode, editAgentId, organizationId, uploadAudio]);

  // =====================================================
  // Upload de arquivo
  // =====================================================
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      const name = file.name.replace(/\.[^/.]+$/, "");

      if (isEditMode && editAgentId && organizationId) {
        uploadAudio.mutate({ agentId: editAgentId, organizationId, file, name });
      } else {
        setPendingAudios((prev) => [
          ...prev,
          { file, name, previewUrl: URL.createObjectURL(file) },
        ]);
      }

      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [isEditMode, editAgentId, organizationId, uploadAudio]
  );

  // =====================================================
  // Remover áudio
  // =====================================================
  const handleDeleteExisting = useCallback(
    (audio: CopilotAgentAudio) => {
      if (!editAgentId) return;
      deleteAudio.mutate({
        audioId: audio.id,
        storagePath: audio.storage_path,
        agentId: editAgentId,
      });
    },
    [editAgentId, deleteAudio]
  );

  const handleDeletePending = useCallback((index: number) => {
    setPendingAudios((prev) => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

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

      {/* ================================================================ */}
      {/* SEÇÃO DE ÁUDIOS PRÉ-GRAVADOS */}
      {/* ================================================================ */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-primary" />
              Áudios de Abordagem
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Envie áudios pré-gravados junto com a primeira mensagem para aumentar a taxa de resposta
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="audio-enabled" className="text-sm">
              {audioEnabled ? "Ativado" : "Desativado"}
            </Label>
            <Switch
              id="audio-enabled"
              checked={audioEnabled}
              onCheckedChange={(checked) => {
                setValue("outboundConfig.audioEnabled", checked, { shouldValidate: true });
              }}
            />
          </div>
        </div>

        {/* Ordem de envio */}
        {audioEnabled && (
          <div className="bg-muted/30 border rounded-lg p-4 space-y-3">
            <Label className="text-sm font-medium">Ordem de envio</Label>
            <RadioGroup
              value={audioSendOrder}
              onValueChange={(value) => {
                setValue("outboundConfig.audioSendOrder", value as "text_first" | "audio_first", {
                  shouldValidate: true,
                });
              }}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="text_first" id="text_first" />
                <Label htmlFor="text_first" className="text-sm cursor-pointer">
                  Texto primeiro, depois áudio
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="audio_first" id="audio_first" />
                <Label htmlFor="audio_first" className="text-sm cursor-pointer">
                  Áudio primeiro, depois texto
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              Delay de ~8 segundos entre texto e áudio para simular comportamento humano
            </p>
          </div>
        )}

        {/* Lista de áudios existentes (modo edição) */}
        {activeExistingCount > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">
              Áudios cadastrados ({totalAudios}/{MAX_AUDIOS})
            </span>
            <div className="space-y-2">
              {existingAudios
                .filter((a) => a.is_active)
                .map((audio) => (
                  <div
                    key={audio.id}
                    className="flex items-center gap-3 p-3 border rounded-lg bg-muted/20"
                  >
                    <Volume2 className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">
                      {audio.name || "Áudio sem nome"}
                    </span>
                    <audio
                      src={audio.public_url}
                      controls
                      preload="metadata"
                      className="h-8 max-w-[200px]"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteExisting(audio)}
                      disabled={deleteAudio.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Lista de áudios pendentes (modo criação) */}
        {pendingAudios.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">
              Áudios a enviar ({totalAudios}/{MAX_AUDIOS})
            </span>
            <div className="space-y-2">
              {pendingAudios.map((audio, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 border rounded-lg bg-muted/20 border-dashed"
                >
                  <Volume2 className="w-4 h-4 text-orange-400 shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">
                    {audio.name}
                  </span>
                  <audio
                    src={audio.previewUrl}
                    controls
                    preload="metadata"
                    className="h-8 max-w-[200px]"
                  />
                  <Badge variant="outline" className="text-xs shrink-0">
                    Pendente
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => handleDeletePending(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Botões de ação */}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAddMore || uploadAudio.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload arquivo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAddMore || uploadAudio.isPending}
            onClick={() => {
              setAudioBlob(null);
              setAudioName("");
              setRecordingTime(0);
              setShowRecordDialog(true);
            }}
          >
            <Mic className="w-4 h-4 mr-2" />
            Gravar áudio
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_AUDIO_TYPES}
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {!canAddMore && (
          <p className="text-xs text-muted-foreground">
            Limite de {MAX_AUDIOS} áudios atingido. Remova um áudio para adicionar outro.
          </p>
        )}

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <h4 className="font-semibold text-amber-400 mb-2">Como funciona</h4>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Cadastre até {MAX_AUDIOS} áudios de abordagem</li>
            <li>O sistema escolhe um aleatoriamente a cada envio</li>
            <li>O áudio é enviado como mensagem de voz (bolinha azul no WhatsApp)</li>
            <li>A rotação de áudios evita que o WhatsApp detecte mensagens repetitivas</li>
          </ul>
        </div>
      </div>

      {/* ================================================================ */}
      {/* DIALOG DE GRAVAÇÃO */}
      {/* ================================================================ */}
      <Dialog
        open={showRecordDialog}
        onOpenChange={(open) => {
          if (!open) {
            stopRecording();
            setAudioBlob(null);
            setAudioName("");
          }
          setShowRecordDialog(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="w-5 h-5" />
              Gravar Áudio
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4 py-4">
              {!audioBlob ? (
                <>
                  <div className="text-4xl font-mono tabular-nums">
                    {formatTime(recordingTime)}
                  </div>
                  <Button
                    type="button"
                    variant={isRecording ? "destructive" : "default"}
                    size="lg"
                    onClick={isRecording ? stopRecording : startRecording}
                    className="rounded-full w-16 h-16"
                  >
                    {isRecording ? (
                      <Square className="w-6 h-6" />
                    ) : (
                      <Mic className="w-6 h-6" />
                    )}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {isRecording
                      ? "Clique para parar a gravação"
                      : "Clique para iniciar a gravação"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Preview do áudio gravado ({formatTime(recordingTime)})
                  </p>
                  <audio
                    src={URL.createObjectURL(audioBlob)}
                    controls
                    className="w-full"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAudioBlob(null);
                      setRecordingTime(0);
                    }}
                  >
                    Gravar novamente
                  </Button>
                </>
              )}
            </div>

            {audioBlob && (
              <div className="space-y-2">
                <Label htmlFor="audio-name">Nome do áudio</Label>
                <Input
                  id="audio-name"
                  placeholder="Ex: Abertura informal"
                  value={audioName}
                  onChange={(e) => setAudioName(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                stopRecording();
                setShowRecordDialog(false);
                setAudioBlob(null);
                setAudioName("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!audioBlob || uploadAudio.isPending}
              onClick={handleSaveRecording}
            >
              Salvar áudio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
