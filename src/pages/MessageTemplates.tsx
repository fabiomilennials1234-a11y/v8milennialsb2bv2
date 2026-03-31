import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  FileText,
  Eye,
  Loader2,
} from "lucide-react";
import {
  useMessageTemplates,
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
  useDeleteMessageTemplate,
  type MessageTemplate,
} from "@/hooks/useMessageTemplates";
import {
  TEMPLATE_VARIABLES,
  resolveVariables,
  PREVIEW_LEAD,
  PREVIEW_ATTENDANT,
} from "@/lib/template-variables";

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSave = useCallback(async () => {
    if (!command || !displayName || !body) return;
    if (commandError) return;

    const payload = { command, display_name: displayName, body };

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

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const preview = resolveVariables(body, PREVIEW_LEAD, PREVIEW_ATTENDANT);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-muted-foreground">
            Gerencie templates de mensagem com variáveis dinâmicas
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por comando ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-5 animate-pulse space-y-3"
            >
              <div className="h-5 w-24 rounded bg-muted" />
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-8 w-full rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="group rounded-lg border bg-card p-5 space-y-3 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-sm font-semibold text-primary">
                  /{t.command}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleDelete(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="text-sm font-medium">{t.display_name}</p>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {t.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(t.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="rounded-lg border bg-card p-12 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            Nenhum template cadastrado
          </h3>
          <p className="text-muted-foreground mb-4">
            Crie templates com variáveis para agilizar suas mensagens
          </p>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Template
          </Button>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar Template" : "Novo Template"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Command */}
            <div className="space-y-2">
              <Label htmlFor="tpl-command">Comando</Label>
              <div className="flex items-center gap-0">
                <span className="flex h-9 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground font-mono">
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

            {/* Body */}
            <div className="space-y-2">
              <Label htmlFor="tpl-body">Corpo da mensagem</Label>
              <Textarea
                id="tpl-body"
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Olá {nome}, tudo bem? Aqui é {atendente} da {empresa}..."
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
                  <span>Preview</span>
                </div>
                <div className="rounded-md border bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                  {preview}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
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
                isSaving || !command || !displayName || !body || !!commandError
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
