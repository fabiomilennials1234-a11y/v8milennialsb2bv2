import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FileText, Eye, Variable, Mic, MicOff, Upload, Trash2, ImageIcon, File } from "lucide-react";
import {
  useCreateCampaignTemplate,
  TEMPLATE_VARIABLES,
  replaceVariablesWithExamples,
  uploadCampaignTemplateAudio,
  uploadCampaignTemplateImage,
  uploadCampaignTemplateDocument,
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { organizationId } = useOrganization();
  const createTemplate = useCreateCampaignTemplate();

  const activeTextareaRef = messageType === "text" ? textareaRef : captionRef;

  const handleInsertVariable = (variableKey: string) => {
    const textarea = activeTextareaRef.current;
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
    } catch (err) {
      console.error("[CreateTemplateModal AudioRecorder] getUserMedia failed:", err);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, []);

  // Clean up image preview URL when image changes
  useEffect(() => {
    if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImagePreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setImagePreviewUrl(null);
    }
  }, [imageFile]);

  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("audio/")) {
      setAudioBlob(file);
      setMessageType("audio");
    } else if (file) {
      toast.error("Selecione um arquivo de áudio (mp3, ogg, webm, etc.)");
    }
    e.target.value = "";
  };

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setImageFile(file);
    } else if (file) {
      toast.error("Selecione um arquivo de imagem (jpg, png, webp, gif)");
    }
    e.target.value = "";
  };

  const handleDocumentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDocumentFile(file);
      if (!fileName) {
        setFileName(file.name);
      }
    }
    e.target.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Nome do template é obrigatório");
      return;
    }

    if (messageType === "text" && !content.trim()) {
      toast.error("Conteúdo do template é obrigatório");
      return;
    }
    if (messageType === "audio" && !audioBlob) {
      toast.error("Grave ou envie um áudio para o template");
      return;
    }
    if (messageType === "image" && !imageFile) {
      toast.error("Selecione uma imagem para o template");
      return;
    }
    if (messageType === "document" && !documentFile) {
      toast.error("Selecione um documento para o template");
      return;
    }
    if ((messageType === "audio" || messageType === "image" || messageType === "document") && !organizationId) {
      toast.error("Organização não encontrada");
      return;
    }

    // Extract used variables from content (caption for image/document)
    const usedVariables: string[] = [];
    if (content) {
      for (const variable of TEMPLATE_VARIABLES) {
        if (content.includes(`{${variable.key}}`)) usedVariables.push(variable.key);
      }
    }
    // Also check fileName for variables
    if (fileName) {
      for (const variable of TEMPLATE_VARIABLES) {
        if (fileName.includes(`{${variable.key}}`) && !usedVariables.includes(variable.key)) {
          usedVariables.push(variable.key);
        }
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
      } else if (messageType === "image" && imageFile && organizationId) {
        const imageUrl = await uploadCampaignTemplateImage(imageFile, organizationId);
        newTemplate = await createTemplate.mutateAsync({
          name: name.trim(),
          content: content.trim() || "",
          message_type: "image",
          image_url: imageUrl,
          available_variables: usedVariables.length > 0 ? usedVariables : undefined,
        });
      } else if (messageType === "document" && documentFile && organizationId) {
        const documentUrl = await uploadCampaignTemplateDocument(documentFile, organizationId);
        newTemplate = await createTemplate.mutateAsync({
          name: name.trim(),
          content: content.trim() || "",
          message_type: "document",
          document_url: documentUrl,
          file_name: fileName.trim() || documentFile.name,
          available_variables: usedVariables.length > 0 ? usedVariables : undefined,
        });
      } else {
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
    setImageFile(null);
    setImagePreviewUrl(null);
    setDocumentFile(null);
    setFileName("");
    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    onOpenChange(isOpen);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const showCaptionSection = messageType === "image" || messageType === "document";

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
              placeholder="Ex: Primeiro Contato, Follow-up, Proposta Comercial..."
            />
          </div>

          <div className="space-y-3">
            <Label>Tipo da mensagem de disparo</Label>
            <RadioGroup
              value={messageType}
              onValueChange={(v) => {
                setMessageType(v as CampaignTemplateMessageType);
                if (v === "text") {
                  setAudioBlob(null);
                  setImageFile(null);
                  setDocumentFile(null);
                }
              }}
              className="grid grid-cols-2 gap-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="text" id="type-text" />
                <Label htmlFor="type-text" className="font-normal cursor-pointer">Texto</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="audio" id="type-audio" />
                <Label htmlFor="type-audio" className="font-normal cursor-pointer">Áudio</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="image" id="type-image" />
                <Label htmlFor="type-image" className="font-normal cursor-pointer">Imagem</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="document" id="type-document" />
                <Label htmlFor="type-document" className="font-normal cursor-pointer">Documento</Label>
              </div>
            </RadioGroup>
          </div>

          {/* === TEXT === */}
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

          {/* === AUDIO === */}
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
                        onChange={handleAudioFileSelect}
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

          {/* === IMAGE === */}
          {messageType === "image" && (
            <Card className="bg-muted/30 border-primary/20">
              <CardContent className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Esta imagem será enviada com uma legenda para cada lead no disparo.
                </p>
                {!imageFile ? (
                  <Label className="flex flex-col items-center gap-3 cursor-pointer p-6 rounded-lg border-2 border-dashed bg-background hover:bg-muted/50 transition-colors">
                    <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Clique para selecionar uma imagem</span>
                    <span className="text-xs text-muted-foreground">JPG, PNG, WebP, GIF</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageFileSelect}
                    />
                  </Label>
                ) : (
                  <div className="space-y-3">
                    {imagePreviewUrl && (
                      <div className="rounded-lg overflow-hidden border">
                        <img
                          src={imagePreviewUrl}
                          alt="Preview"
                          className="max-h-48 w-full object-contain bg-muted/20"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                      <span className="text-sm truncate">
                        {imageFile.name} · {(imageFile.size / 1024).toFixed(1)} KB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setImageFile(null)}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Remover
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* === DOCUMENT === */}
          {messageType === "document" && (
            <Card className="bg-muted/30 border-primary/20">
              <CardContent className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Este documento será enviado com uma legenda para cada lead no disparo.
                </p>
                {!documentFile ? (
                  <Label className="flex flex-col items-center gap-3 cursor-pointer p-6 rounded-lg border-2 border-dashed bg-background hover:bg-muted/50 transition-colors">
                    <File className="w-8 h-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Clique para selecionar um documento</span>
                    <span className="text-xs text-muted-foreground">PDF, XLSX, DOCX, CSV e outros</span>
                    <input
                      type="file"
                      accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.pptx,.ppt,.txt"
                      className="hidden"
                      onChange={handleDocumentFileSelect}
                    />
                  </Label>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                      <div className="flex items-center gap-2 min-w-0">
                        <File className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-sm truncate">
                          {documentFile.name} · {(documentFile.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setDocumentFile(null); setFileName(""); }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Remover
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="customFileName">Nome do arquivo no WhatsApp</Label>
                      <Input
                        id="customFileName"
                        value={fileName}
                        onChange={(e) => setFileName(e.target.value)}
                        placeholder="Ex: Proposta {empresa}.pdf"
                      />
                      <p className="text-xs text-muted-foreground">
                        Use variáveis como {"{empresa}"} para personalizar o nome por lead
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* === CAPTION/LEGENDA for image & document === */}
          {showCaptionSection && (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Variable className="w-4 h-4" />
                  Variáveis disponíveis
                </Label>
                <p className="text-xs text-muted-foreground">Clique para inserir na legenda</p>
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
                  <Label>Legenda (opcional)</Label>
                  {content && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
                      <Eye className="w-4 h-4 mr-1" />
                      {showPreview ? "Editar" : "Preview"}
                    </Button>
                  )}
                </div>
                {showPreview && content ? (
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="text-sm whitespace-pre-wrap">
                        {replaceVariablesWithExamples(content)}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Textarea
                    ref={captionRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={`Olá {nome}, segue ${messageType === "image" ? "a imagem" : "o documento"} da {empresa}...`}
                    rows={4}
                    className="font-mono text-sm"
                  />
                )}
              </div>
            </>
          )}

          {/* === Tips for text === */}
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
