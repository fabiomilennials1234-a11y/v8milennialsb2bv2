import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  ExternalLink,
  LayoutList,
} from "lucide-react";
import { InkPanel } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { useWhatsAppInstances } from "@/modules/communication/hooks/useWhatsAppInstances";
import { FilterChip } from "@/shared/components/FilterChip";
import { FilterRow, PillSearch } from "@/shared/components/PillSearch";
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

const TYPE_FILTERS: { key: MediaType | "all"; label: string; icon?: typeof Image }[] = [
  { key: "all", label: "Todos", icon: LayoutList },
  { key: "text", label: "Texto", icon: FileText },
  { key: "image", label: "Imagem", icon: Image },
  { key: "video", label: "Vídeo", icon: Video },
  { key: "audio", label: "Áudio", icon: Mic },
  { key: "document", label: "Documento", icon: File },
];

/** Variáveis `{nome}` usadas no corpo, na ordem em que aparecem. */
function variablesIn(body: string): string[] {
  return [...new Set(body.match(/\{[a-z_]+\}/gi) ?? [])];
}

/**
 * A prévia em tinta: como o template chega no WhatsApp, com as variáveis
 * preenchidas por um EXEMPLO (o mesmo lead fictício do editor).
 */
function TemplatePreview({
  template,
  onEdit,
  onDelete,
}: {
  template: MessageTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const type = template.media_type ?? "text";
  const Icon = MEDIA_ICON[type] ?? FileText;
  const typeLabel = type === "text" ? "Texto" : MEDIA_TYPE_CONFIG[type as keyof typeof MEDIA_TYPE_CONFIG]?.label ?? type;
  const resolved = resolveVariables(template.body, PREVIEW_LEAD, PREVIEW_ATTENDANT);
  const vars = variablesIn(template.body);
  return (
    <InkPanel title="Prévia no WhatsApp" className="lg:sticky lg:top-4">
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-white/[.04]">
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-extrabold text-tinta-foreground">
            {PREVIEW_LEAD.name?.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-tinta-foreground">{PREVIEW_LEAD.name}</span>
            <span className="block truncate text-[11px] text-tinta-muted">{PREVIEW_LEAD.company} · exemplo</span>
          </span>
        </div>
        <div className="min-h-[200px] bg-background/95 px-3 py-3 [background-image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:14px_14px]">
          <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-primary px-3 py-2 text-[13px] leading-snug text-primary-foreground shadow-relevo">
            {type !== "text" && (
              <span className="mb-1.5 flex items-center gap-2 rounded-xl bg-primary-foreground/10 px-2.5 py-2 text-[12px] font-bold">
                {type === "image" && template.media_url ? (
                  <img src={template.media_url} alt="" className="h-16 w-full rounded-lg object-cover" />
                ) : (
                  <>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {typeLabel}
                  </>
                )}
              </span>
            )}
            <p className="whitespace-pre-wrap break-words">{resolved || <span className="opacity-60">Sem texto</span>}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate rounded-full bg-white/[.06] px-3 py-1.5 text-[12px] text-tinta-muted">
            <span className="font-mono font-bold text-primary">/{template.command}</span> + Enter envia
          </span>
        </div>
      </div>

      <dl className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[.04] p-3.5 text-[12.5px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-tinta-muted">Comando</dt>
          <dd className="font-mono font-bold text-tinta-foreground">/{template.command}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-tinta-muted">Tipo de conteúdo</dt>
          <dd className="flex items-center gap-1.5 font-bold text-tinta-foreground">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {typeLabel}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-tinta-muted">Criado em</dt>
          <dd className="font-bold tabular-nums text-tinta-foreground">{formatDate(template.created_at)}</dd>
        </div>
        {vars.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <dt className="mr-1 text-tinta-muted">Variáveis</dt>
            {vars.map((v) => (
              <dd key={v} className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-tinta-foreground">
                {v}
              </dd>
            ))}
          </div>
        )}
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar template /${template.command}`}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-tinta-foreground text-[13px] font-bold text-tinta shadow-relevo transition-colors hover:bg-tinta-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          Editar template
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir template /${template.command}`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.06] text-tinta-foreground transition-colors hover:bg-destructive/20 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </InkPanel>
  );
}

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

  const navigate = useNavigate();
  const { data: instances } = useWhatsAppInstances();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<MediaType | "all">("all");
  const [order, setOrder] = useState<"az" | "recent">("az");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    if (typeFilter !== "all" && (t.media_type ?? "text") !== typeFilter) return false;
    return (
      t.command.toLowerCase().includes(q) ||
      t.display_name.toLowerCase().includes(q)
    );
  });
  const listed = [...filtered].sort((a, b) =>
    order === "az"
      ? a.command.localeCompare(b.command, "pt-BR")
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

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

  const hasOfficialChannel = (instances ?? []).some((i) => i.provider === "notificame");
  const counts = TYPE_FILTERS.map((f) => ({
    ...f,
    count: f.key === "all" ? (templates ?? []).length : (templates ?? []).filter((t) => (t.media_type ?? "text") === f.key).length,
  }));
  const selected = listed.find((t) => t.id === selectedId) ?? listed[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Templates"
        subtitle="Respostas rápidas do chat: digite / e o comando para inserir. Aceitam variáveis dinâmicas."
        secondaryActions={
          hasOfficialChannel
            ? [
                {
                  label: "Templates oficiais (Meta)",
                  icon: ExternalLink,
                  // Os templates aprovados vivem em Configurações › WhatsApp, no
                  // número do Canal Oficial — aqui só o atalho, sem duplicar.
                  onSelect: () => navigate("/configuracoes?tab=whatsapp"),
                },
              ]
            : undefined
        }
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Novo template
          </Button>
        }
      />

      {/* Filtros: tipo de conteúdo + busca */}
      <FilterRow>
        <span className="mr-1 shrink-0 text-[13px] font-bold text-foreground/80">Tipo de conteúdo</span>
        {counts
          .filter((f) => f.key === "all" || f.count > 0)
          .map((f) => (
            <FilterChip
              key={f.key}
              icon={f.icon}
              active={typeFilter === f.key}
              aria-pressed={typeFilter === f.key}
              count={f.count}
              onClick={() => setTypeFilter(f.key)}
            >
              {f.label}
            </FilterChip>
          ))}
        <PillSearch
          value={search}
          onValueChange={setSearch}
          placeholder="Buscar por comando ou nome..."
          className="ml-auto w-56 shrink-0 sm:w-72"
        />
      </FilterRow>

      {/* Loading */}
      {isLoading && (
        <Card className="animate-pulse space-y-3 p-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-full rounded-2xl bg-muted" />
          ))}
        </Card>
      )}

      {/* Lista + prévia em tinta */}
      {!isLoading && listed.length > 0 && selected && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
          <Card className="min-w-0 p-2">
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-2.5">
              <div>
                <h2 className="text-base font-bold tracking-tight">Templates</h2>
                <p className="text-xs text-muted-foreground">
                  {listed.length} de {(templates ?? []).length} · clique para ver a prévia
                </p>
              </div>
              <div role="radiogroup" aria-label="Ordenar" className="inline-flex rounded-full bg-muted p-[3px]">
                {(
                  [
                    ["az", "A–Z"],
                    ["recent", "Recentes"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={order === key}
                    onClick={() => setOrder(key)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      order === key ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="space-y-0.5">
              {listed.map((t) => {
                const Icon = MEDIA_ICON[t.media_type ?? "text"] ?? FileText;
                const isSel = t.id === selected.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-pressed={isSel}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSel ? "bg-primary-soft" : "hover:bg-muted/50",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-[11px]",
                          isSel ? "bg-card text-foreground shadow-relevo" : "bg-muted text-foreground/70",
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[12px] font-bold text-foreground",
                              isSel ? "bg-card shadow-relevo" : "bg-muted",
                            )}
                          >
                            /{t.command}
                          </span>
                          <span className="truncate text-[14px] font-bold tracking-tight">{t.display_name}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t.body || "—"}</span>
                      </span>
                      <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:block">
                        {formatDate(t.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <TemplatePreview
            template={selected}
            onEdit={() => openEdit(selected)}
            onDelete={() => handleDelete(selected)}
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && listed.length === 0 && (
        <Card className="flex flex-col items-center p-12 text-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
            <FileText className="h-5 w-5" />
          </span>
          <h3 className="mb-1.5 text-lg font-bold tracking-tight">
            {search || typeFilter !== "all" ? "Nenhum template encontrado" : "Nenhum template cadastrado"}
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
