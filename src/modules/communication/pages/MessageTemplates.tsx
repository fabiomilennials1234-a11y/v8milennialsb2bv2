import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  FileText,
  Eye,
  Loader2,
  Image,
  Mic,
  Video,
  File,
  Upload,
  X,
} from "lucide-react";
import {
  useMessageTemplates,
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
  useDeleteMessageTemplate,
  type MessageTemplate,
  type MediaType,
} from "@/modules/communication/hooks/useMessageTemplates";
import {
  TEMPLATE_VARIABLES,
  resolveVariables,
  PREVIEW_LEAD,
  PREVIEW_ATTENDANT,
} from "@/lib/template-variables";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MEDIA_TYPE_CONFIG: Record<Exclude<MediaType, "text">, { label: string; icon: typeof Image; accept: string }> = {
  image: { label: "Imagem", icon: Image, accept: "image/jpeg,image/png,image/webp,image/gif" },
  audio: { label: "Áudio", icon: Mic, accept: "audio/mpeg,audio/ogg,audio/wav,audio/mp4" },
  video: { label: "Vídeo", icon: Video, accept: "video/mp4,video/webm" },
  document: { label: "Documento", icon: File, accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

const MEDIA_ICON: Record<MediaType, typeof FileText> = {
  text: FileText,
  image: Image,
  audio: Mic,
  video: Video,
  document: File,
};

const COMMAND_REGEX = /^[a-z0-9][a-z0-9-]*$/;

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

export default function MessageTemplates() {
  const { data: templates, isLoading } = useMessageTemplates();
  const createMutation = useCreateMessageTemplate();
  const updateMutation = useUpdateMessageTemplate();
  const deleteMutation = useDeleteMessageTemplate();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);

  // Form fields
  const [command, setCommand] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [body, setBody] = useState("");
  const [commandError, setCommandError] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("text");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = (templates ?? []).filter((t) => {
    const q = search.toLowerCase();
    return (
      t.command.toLowerCase().includes(q) ||
      t.display_name.toLowerCase().includes(q)
    );
  });

  const resetForm = useCallback(() => {
    setCommand("");
    setDisplayName("");
    setBody("");
    setCommandError("");
    setMediaType("text");
    setMediaUrl(null);
    setEditing(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((t: MessageTemplate) => {
    setEditing(t);
    setCommand(t.command);
    setDisplayName(t.display_name);
    setBody(t.body);
    setMediaType(t.media_type ?? "text");
    setMediaUrl(t.media_url ?? null);
    setCommandError("");
    setModalOpen(true);
  }, []);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open) {
        resetForm();
        setModalOpen(false);
      }
    },
    [resetForm],
  );

  const handleCommandChange = useCallback((value: string) => {
    setCommand(value);
    if (value && !COMMAND_REGEX.test(value)) {
      setCommandError("Apenas letras minúsculas, números e hifens");
    } else {
      setCommandError("");
    }
  }, []);

  const handleVariableInsert = useCallback(
    (variable: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newBody = body.slice(0, start) + variable + body.slice(end);
      setBody(newBody);
      // Restore focus and cursor position after insertion
      requestAnimationFrame(() => {
        el.focus();
        const cursor = start + variable.length;
        el.setSelectionRange(cursor, cursor);
      });
    },
    [body],
  );

  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `templates/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
      setMediaUrl(urlData.publicUrl);
      toast.success("Arquivo enviado");
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!command || !displayName) return;
    if (mediaType === "text" && !body) return;
    if (mediaType !== "text" && !mediaUrl && !body) return;
    if (commandError) return;

    const payload = {
      command,
      display_name: displayName,
      body,
      media_url: mediaType !== "text" ? mediaUrl : null,
      media_type: mediaType,
    };

    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }

    setModalOpen(false);
    resetForm();
  }, [
    command,
    displayName,
    body,
    commandError,
    mediaType,
    mediaUrl,
    editing,
    createMutation,
    updateMutation,
    resetForm,
  ]);

  const handleDelete = useCallback(
    (t: MessageTemplate) => {
      const confirmed = window.confirm(
        `Remover o template /${t.command}? Esta ação não pode ser desfeita.`,
      );
      if (confirmed) {
        deleteMutation.mutate(t.id);
      }
    },
    [deleteMutation],
  );

  const isSaving = createMutation.isPending || updateMutation.isPending || uploading;
  const preview = resolveVariables(body, PREVIEW_LEAD, PREVIEW_ATTENDANT);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Templates"
        subtitle="Respostas rápidas do chat: digite / e o comando para inserir. Aceitam variáveis dinâmicas."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Novo template
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por comando ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-full pl-10 shadow-relevo"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse space-y-3 p-5">
              <div className="h-5 w-24 rounded-full bg-muted" />
              <div className="h-4 w-40 rounded-full bg-muted" />
              <div className="h-8 w-full rounded-xl bg-muted" />
            </Card>
          ))}
        </div>
      )}

      {/* Grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="group flex flex-col gap-3 p-5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full bg-primary-soft px-2.5 py-1 font-mono text-[12.5px] font-bold text-primary-soft-foreground">
                  /{t.command}
                </span>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(t)}
                    aria-label={`Editar template /${t.command}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleDelete(t)}
                    aria-label={`Excluir template /${t.command}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="text-[15px] font-bold leading-tight tracking-tight">{t.display_name}</p>
              {t.media_type && t.media_type !== "text" && (
                <div className="flex items-center gap-1.5">
                  {(() => { const Icon = MEDIA_ICON[t.media_type] ?? FileText; return <Icon className="h-3.5 w-3.5 text-muted-foreground" />; })()}
                  <span className="text-xs font-semibold text-foreground/80">
                    {MEDIA_TYPE_CONFIG[t.media_type as keyof typeof MEDIA_TYPE_CONFIG]?.label ?? t.media_type}
                  </span>
                  {t.media_type === "image" && t.media_url && (
                    <img src={t.media_url} alt="" className="ml-auto h-10 w-10 rounded-xl object-cover" />
                  )}
                </div>
              )}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {t.body}
              </p>
              <p className="mt-auto text-xs tabular-nums text-muted-foreground">
                {formatDate(t.created_at)}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <Card className="flex flex-col items-center p-12 text-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
            <FileText className="h-5 w-5" />
          </span>
          <h3 className="mb-1.5 text-lg font-bold tracking-tight">
            {search ? "Nenhum template encontrado" : "Nenhum template cadastrado"}
          </h3>
          <p className="mb-5 max-w-sm text-sm text-muted-foreground">
            Crie templates com variáveis para agilizar suas mensagens
          </p>
          <Button variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Novo template
          </Button>
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={handleClose}>
        <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-lg max-sm:overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {editing ? "Editar template" : "Novo template"}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 flex flex-col gap-4">
            {/* Command */}
            <div className="space-y-2">
              <Label htmlFor="tpl-command">Comando</Label>
              <div className="flex items-center gap-0">
                <span className="flex h-10 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 font-mono text-sm text-muted-foreground">
                  /
                </span>
                <Input
                  id="tpl-command"
                  value={command}
                  onChange={(e) => handleCommandChange(e.target.value)}
                  placeholder="saudacao"
                  className="rounded-l-none font-mono"
                />
              </div>
              {commandError && (
                <p className="text-sm text-destructive">{commandError}</p>
              )}
            </div>

            {/* Display name */}
            <div className="space-y-2">
              <Label htmlFor="tpl-display-name">Nome de exibição</Label>
              <Input
                id="tpl-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Saudação inicial"
              />
            </div>

            {/* Media Type */}
            <div className="space-y-2">
              <Label>Tipo de conteúdo</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {(["text", "image", "audio", "video", "document"] as MediaType[]).map((type) => {
                  const Icon = MEDIA_ICON[type];
                  const label = type === "text" ? "Texto" : MEDIA_TYPE_CONFIG[type as keyof typeof MEDIA_TYPE_CONFIG]?.label ?? type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setMediaType(type); if (type === "text") { setMediaUrl(null); } }}
                      aria-pressed={mediaType === type}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs font-semibold transition-colors ${
                        mediaType === type
                          ? "border-transparent bg-primary-soft text-primary-soft-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Media Upload */}
            {mediaType !== "text" && (
              <div className="space-y-2">
                <Label>Arquivo</Label>
                {mediaUrl ? (
                  <div className="flex items-center gap-3 rounded-xl border bg-sunken p-3">
                    {mediaType === "image" && (
                      <img src={mediaUrl} alt="" className="h-16 w-16 rounded object-cover" />
                    )}
                    {mediaType === "audio" && (
                      <audio controls src={mediaUrl} className="h-8 flex-1" />
                    )}
                    {mediaType === "video" && (
                      <video controls src={mediaUrl} className="h-20 rounded" />
                    )}
                    {mediaType === "document" && (
                      <div className="flex items-center gap-2 text-sm">
                        <File className="h-5 w-5 text-muted-foreground" />
                        <span className="truncate max-w-[200px]">{mediaUrl.split("/").pop()}</span>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 ml-auto shrink-0"
                      onClick={() => setMediaUrl(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-6 transition-colors hover:border-primary/50"
                  >
                    {uploading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    ) : (
                      <Upload className="h-6 w-6 text-muted-foreground" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {uploading ? "Enviando..." : "Clique para enviar arquivo"}
                    </span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={MEDIA_TYPE_CONFIG[mediaType as keyof typeof MEDIA_TYPE_CONFIG]?.accept ?? "*/*"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {/* Body */}
            <div className="space-y-2">
              <Label htmlFor="tpl-body">
                {mediaType === "text" ? "Corpo da mensagem" : "Legenda (opcional)"}
              </Label>
              <Textarea
                id="tpl-body"
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={mediaType === "text" ? 5 : 3}
                placeholder={mediaType === "text"
                  ? "Olá {nome}, tudo bem? Aqui é {atendente} da {empresa}..."
                  : "Legenda do arquivo..."
                }
              />
            </div>

            {/* Variable badges */}
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Clique para inserir variável na posição do cursor:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <Badge
                    key={v.name}
                    variant="secondary"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                    onClick={() => handleVariableInsert(v.name)}
                    title={v.description}
                  >
                    {v.name}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Preview */}
            {body && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" />
                  <span>Pré-visualização</span>
                </div>
                <div className="whitespace-pre-wrap break-words rounded-xl border bg-sunken p-3 text-sm [overflow-wrap:anywhere]">
                  {preview}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                isSaving || !command || !displayName || !!commandError ||
                (mediaType === "text" && !body) ||
                (mediaType !== "text" && !mediaUrl && !body)
              }
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
