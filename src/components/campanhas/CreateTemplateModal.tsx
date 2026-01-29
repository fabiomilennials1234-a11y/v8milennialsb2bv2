import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FileText, Eye, Variable, Mic, MicOff, Upload, Trash2 } from "lucide-react";
import {
  useCreateCampaignTemplate,
  TEMPLATE_VARIABLES,
  replaceVariablesWithExamples,
  uploadCampaignTemplateAudio,
  type CampaignTemplateMessageType,
} from "@/hooks/useCampaignTemplates";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

interface CreateTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (templateId: string) => void;
}

export function CreateTemplateModal({ open, onOpenChange, onSuccess }: CreateTemplateModalProps) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [messageType, setMessageType] = useState<CampaignTemplateMessageType>("text");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { organizationId } = useOrganization();
  const createTemplate = useCreateCampaignTemplate();

  const handleInsertVariable = (variableKey: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const variableText = `{${variableKey}}`;
    const newContent = content.substring(0, start) + variableText + content.substring(end);
    setContent(newContent);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variableText.length, start + variableText.length);
    }, 0);
  };

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
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setAudioBlob(blob);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("audio/")) {
      setAudioBlob(file);
      setMessageType("audio");
    } else if (file) {
      toast.error("Selecione um arquivo de áudio (mp3, ogg, webm, etc.)");
    }
    e.target.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Nome do template é obrigatório");
      return;
    }
    if (messageType === "text") {
      if (!content.trim()) {
        toast.error("Conteúdo do template é obrigatório");
        return;
      }
    } else {
      if (!audioBlob) {
        toast.error("Grave ou envie um áudio para o template");
        return;
      }
      if (!organizationId) {
        toast.error("Organização não encontrada");
        return;
      }
    }

    try {
      let newTemplate;
      if (messageType === "audio" && audioBlob && organizationId) {
        const audioUrl = await uploadCampaignTemplateAudio(audioBlob, organizationId);
        newTemplate = await createTemplate.mutateAsync({
          name: name.trim(),
          content: "Mensagem em áudio",
          message_type: "audio",
          audio_url: audioUrl,
          available_variables: [],
        });
      } else {
        const usedVariables: string[] = [];
        for (const variable of TEMPLATE_VARIABLES) {
          if (content.includes(`{${variable.key}}`)) usedVariables.push(variable.key);
        }
        newTemplate = await createTemplate.mutateAsync({
          name: name.trim(),
          content: content.trim(),
          message_type: "text",
          available_variables: usedVariables.length > 0 ? usedVariables : undefined,
        });
      }
      toast.success("Template criado com sucesso!");
      resetForm();
      onSuccess?.(newTemplate.id);
    } catch (error: any) {
      console.error("Erro ao criar template:", error);
      toast.error(error?.message || "Erro ao criar template. Verifique suas permissões.");
    }
  };

  const resetForm = () => {
    setName("");
    setContent("");
    setShowPreview(false);
    setMessageType("text");
    setAudioBlob(null);
    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    onOpenChange(isOpen);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Criar Novo Template
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="templateName">Nome do Template *</Label>
            <Input
              id="templateName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Primeiro Contato, Follow-up, Áudio de Apresentação..."
            />
          </div>

          <div className="space-y-3">
            <Label>Tipo da mensagem de disparo</Label>
            <RadioGroup
              value={messageType}
              onValueChange={(v) => {
                setMessageType(v as CampaignTemplateMessageType);
                if (v === "text") setAudioBlob(null);
              }}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="text" id="type-text" />
                <Label htmlFor="type-text" className="font-normal cursor-pointer">Texto</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="audio" id="type-audio" />
                <Label htmlFor="type-audio" className="font-normal cursor-pointer">Áudio (gravar ou enviar arquivo)</Label>
              </div>
            </RadioGroup>
          </div>

          {messageType === "text" && (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Variable className="w-4 h-4" />
                  Variáveis disponíveis
                </Label>
                <p className="text-xs text-muted-foreground">Clique para inserir no cursor</p>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <Badge
                      key={v.key}
                      variant="secondary"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                      onClick={() => handleInsertVariable(v.key)}
                    >
                      {`{${v.key}}`} <span className="ml-1 opacity-60 text-xs">({v.label})</span>
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="templateContent">Conteúdo da mensagem *</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
                    <Eye className="w-4 h-4 mr-1" />
                    {showPreview ? "Editar" : "Preview"}
                  </Button>
                </div>
                {showPreview ? (
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="text-sm whitespace-pre-wrap">
                        {content ? replaceVariablesWithExamples(content) : (
                          <span className="text-muted-foreground italic">Digite o conteúdo para ver o preview</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Textarea
                    ref={textareaRef}
                    id="templateContent"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={`Olá {nome}! 👋\n\nVi que você trabalha na {empresa}...`}
                    rows={8}
                    className="font-mono text-sm"
                  />
                )}
              </div>
            </>
          )}

          {messageType === "audio" && (
            <Card className="bg-muted/30 border-primary/20">
              <CardContent className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Este áudio será enviado para cada lead no disparo da campanha (Evolution API).
                </p>
                {!audioBlob ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={isRecording ? "destructive" : "default"}
                      size="sm"
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={createTemplate.isPending}
                    >
                      {isRecording ? (
                        <>
                          <MicOff className="w-4 h-4 mr-1" />
                          Parar ({formatTime(recordingTime)})
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4 mr-1" />
                          Gravar áudio
                        </>
                      )}
                    </Button>
                    <Label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-md border bg-background hover:bg-muted/50 text-sm">
                      <Upload className="w-4 h-4" />
                      Enviar arquivo de áudio
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                    </Label>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                    <span className="text-sm">
                      Áudio pronto · {(audioBlob.size / 1024).toFixed(1)} KB
                      {audioBlob.type && ` · ${audioBlob.type.split("/")[1]}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAudioBlob(null)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Remover
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {messageType === "text" && (
            <Card className="bg-blue-500/5 border-blue-500/20">
              <CardContent className="p-4 text-sm space-y-2">
                <p className="font-medium text-blue-700">Dicas para bons templates:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Use o nome do lead para personalizar</li>
                  <li>Seja direto e objetivo</li>
                  <li>Evite mensagens muito longas</li>
                  <li>Inclua uma chamada para ação clara</li>
                  <li>Emojis com moderação podem aumentar engajamento</li>
                </ul>
              </CardContent>
            </Card>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createTemplate.isPending}>
              {createTemplate.isPending ? "Criando..." : "Criar Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
