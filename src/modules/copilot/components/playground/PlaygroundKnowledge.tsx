/**
 * PlaygroundKnowledge — Base de Conhecimento
 *
 * - Upload de documentos (PDF, DOC, TXT)
 * - Upload de midia (imagens, videos) com descricao + quando enviar
 * - Links de URL com apelidos
 * - Referenciavel via @mention no prompt
 */

import { useState, useRef, useCallback } from "react";
import {
  FileText,
  Link2,
  Upload,
  X,
  Plus,
  BookOpen,
  File,
  Image,
  Video,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { KnowledgeDocument, KnowledgeLink, KnowledgeFileType } from "./types";

interface ExistingDocument {
  id: string;
  file_name: string;
  file_size: number | null;
  status: string | null;
  summary: string | null;
  error_message: string | null;
  file_path: string;
  file_type?: string;
  description?: string | null;
  send_when?: string | null;
}

interface PlaygroundKnowledgeProps {
  documents: KnowledgeDocument[];
  links: KnowledgeLink[];
  onDocumentsChange: (docs: KnowledgeDocument[]) => void;
  /** Append docs without depending on current documents closure (avoids stale state) */
  onAddDocuments: (newDocs: KnowledgeDocument[]) => void;
  onLinksChange: (links: KnowledgeLink[]) => void;
  existingDocuments?: ExistingDocument[];
  onDeleteExisting?: (docId: string, filePath: string) => void;
  /**
   * Persist a metadata edit (description / send_when) on an already-saved document.
   * `fileType` lets the caller decide whether to reprocess (media) or just save (document).
   */
  onUpdateExisting?: (
    docId: string,
    updates: { description?: string; send_when?: string },
    fileType: KnowledgeFileType,
  ) => void;
}

const ACCEPTED_TYPES = ".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.mp4,.mov";

/** Limite inline do Gemini para imagem/video. */
const MAX_MEDIA_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Espelha `PDF_MAX_BYTES` da edge function process-agent-document. Sem este
 * gate o arquivo sobe inteiro pro storage e só falha depois, no processamento —
 * o usuário esperava o upload de um catálogo inteiro pra receber erro no fim.
 * Mudou lá, muda aqui (e o `file_size_limit` do bucket também).
 */
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024; // 25MB

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm"]);

function detectFileType(name: string): KnowledgeFileType {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "document";
}

function getFileIcon(fileType: KnowledgeFileType) {
  if (fileType === "image") return Image;
  if (fileType === "video") return Video;
  return File;
}

function getTypeBadge(fileType: KnowledgeFileType) {
  if (fileType === "image") return { label: "Imagem", variant: "default" as const, className: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" };
  if (fileType === "video") return { label: "Video", variant: "default" as const, className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" };
  return { label: "Doc", variant: "secondary" as const, className: "" };
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isMediaType(fileType: KnowledgeFileType): boolean {
  return fileType === "image" || fileType === "video";
}

export function PlaygroundKnowledge({
  documents,
  links,
  onDocumentsChange,
  onAddDocuments,
  onLinksChange,
  existingDocuments = [],
  onDeleteExisting,
  onUpdateExisting,
}: PlaygroundKnowledgeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newLinkAlias, setNewLinkAlias] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  // Local draft of existing-doc metadata edits, keyed by doc id. Persisted on
  // blur (not per keystroke) via onUpdateExisting.
  const [existingDrafts, setExistingDrafts] = useState<
    Record<string, { description: string; send_when: string }>
  >({});

  // Pending list shows ONLY genuinely new uploads (no existingId). Saved docs —
  // which CopilotPlayground also seeds into `documents` for prompt/mention use —
  // are rendered (and edited) in the existing-documents block below, avoiding the
  // double render that previously showed each saved doc twice.
  const pendingDocs = documents.filter((d) => !d.existingId);

  const docCount = pendingDocs.length + existingDocuments.length;
  const linkCount = links.length;

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const newDocs: KnowledgeDocument[] = [];

      for (const file of Array.from(files)) {
        const fileType = detectFileType(file.name);

        // Size validation for media files
        if (isMediaType(fileType) && file.size > MAX_MEDIA_SIZE) {
          toast.error(`${file.name} excede 20MB`, {
            description: `Arquivos de ${fileType === "image" ? "imagem" : "video"} devem ter no maximo 20MB.`,
          });
          continue;
        }

        // Size validation for documents (PDF, DOC, TXT)
        if (!isMediaType(fileType) && file.size > MAX_DOCUMENT_SIZE) {
          toast.error(`${file.name} excede 25MB`, {
            description:
              "Documentos devem ter no maximo 25MB. Divida o catalogo em partes e envie cada uma separadamente.",
          });
          continue;
        }

        newDocs.push({
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          file,
          size: file.size,
          status: "pending" as const,
          fileType,
          description: "",
          sendWhen: "",
        });
      }

      if (newDocs.length > 0) {
        onAddDocuments(newDocs);
      }
    },
    [onAddDocuments]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removeDoc = (id: string) => {
    onDocumentsChange(documents.filter((d) => d.id !== id));
  };

  const updateDoc = (id: string, updates: Partial<KnowledgeDocument>) => {
    onDocumentsChange(documents.map((d) => (d.id === id ? { ...d, ...updates } : d)));
  };

  // ── Existing-doc metadata editing ──────────────────────────────────────────
  const existingDraftValue = (
    doc: ExistingDocument,
    field: "description" | "send_when",
  ): string => {
    const draft = existingDrafts[doc.id];
    if (draft) return draft[field];
    return (field === "description" ? doc.description : doc.send_when) || "";
  };

  const setExistingDraft = (
    doc: ExistingDocument,
    field: "description" | "send_when",
    value: string,
  ) => {
    setExistingDrafts((prev) => ({
      ...prev,
      [doc.id]: {
        description: prev[doc.id]?.description ?? doc.description ?? "",
        send_when: prev[doc.id]?.send_when ?? doc.send_when ?? "",
        [field]: value,
      },
    }));
  };

  // Persist on blur, only when the value actually changed vs the stored one.
  const commitExistingDraft = (
    doc: ExistingDocument,
    field: "description" | "send_when",
  ) => {
    const draft = existingDrafts[doc.id];
    if (!draft || !onUpdateExisting) return;
    const stored = (field === "description" ? doc.description : doc.send_when) || "";
    const next = draft[field];
    if (next === stored) return;
    const ft = (doc.file_type || "document") as KnowledgeFileType;
    onUpdateExisting(doc.id, { [field]: next }, ft);
  };

  // Handle link add
  const addLink = () => {
    if (!newLinkAlias.trim() || !newLinkUrl.trim()) return;
    const newLink: KnowledgeLink = {
      id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      alias: newLinkAlias.trim().replace(/\s+/g, "-").toLowerCase(),
      url: newLinkUrl.trim(),
    };
    onLinksChange([...links, newLink]);
    setNewLinkAlias("");
    setNewLinkUrl("");
  };

  const removeLink = (id: string) => {
    onLinksChange(links.filter((l) => l.id !== id));
  };

  return (
    <div className="border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Base de Conhecimento</span>
          {(docCount > 0 || linkCount > 0) && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {docCount} doc{docCount !== 1 ? "s" : ""}, {linkCount} link{linkCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ===== Documents & Media ===== */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Documentos e Midia
          </Label>

          {/* Drop zone */}
          <div
            className="border-2 border-dashed rounded-lg p-4 text-center hover:bg-muted/50 transition-colors cursor-pointer"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
            <p className="text-xs text-muted-foreground">
              Arraste arquivos aqui ou clique para selecionar
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              PDF, DOC, TXT (ate 25MB), imagens (PNG, JPG) e videos (MP4, MOV) ate 20MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Existing documents from database */}
          {existingDocuments.length > 0 && (
            <div className="space-y-1">
              {existingDocuments.map((doc) => {
                const ft = (doc.file_type || "document") as KnowledgeFileType;
                const Icon = getFileIcon(ft);
                const badge = getTypeBadge(ft);
                const isMedia = isMediaType(ft);
                return (
                  <div key={doc.id} className="rounded-lg bg-muted/30 overflow-hidden">
                    {/* Header row */}
                    <div className="flex items-center justify-between px-3 py-2 group">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs truncate">{doc.file_name}</span>
                        {isMedia && (
                          <span className={`text-[9px] px-1.5 py-0 rounded-full border font-medium ${badge.className}`}>
                            {badge.label}
                          </span>
                        )}
                        {doc.file_size && (
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">
                            {formatSize(doc.file_size)}
                          </span>
                        )}
                        <span className="flex items-center gap-0.5 text-[10px]">
                          {doc.status === "ready" ? (
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                          ) : doc.status === "processing" ? (
                            <Loader2 className="w-3 h-3 text-yellow-500 animate-spin" />
                          ) : doc.status === "error" ? (
                            <AlertCircle className="w-3 h-3 text-red-500" />
                          ) : (
                            <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                          )}
                        </span>
                      </div>
                      {onDeleteExisting && (
                        <button
                          type="button"
                          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => onDeleteExisting(doc.id, doc.file_path)}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Editable metadata — description + "quando enviar". Available
                        for documents (PDF) and media alike. Persisted on blur. */}
                    {onUpdateExisting && (
                      <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-medium text-muted-foreground">
                            {isMedia ? "Descricao do conteudo" : "Descricao (opcional)"}
                          </Label>
                          <Input
                            value={existingDraftValue(doc, "description")}
                            onChange={(e) => setExistingDraft(doc, "description", e.target.value)}
                            onBlur={() => commitExistingDraft(doc, "description")}
                            placeholder={
                              isMedia
                                ? "Ex: Tabela de precos 2026 com planos e comparativo"
                                : "Ex: Catalogo completo de produtos 2026"
                            }
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-medium text-muted-foreground">Quando enviar</Label>
                          <Input
                            value={existingDraftValue(doc, "send_when")}
                            onChange={(e) => setExistingDraft(doc, "send_when", e.target.value)}
                            onBlur={() => commitExistingDraft(doc, "send_when")}
                            placeholder="Ex: Quando o lead pedir o catalogo ou tabela de precos"
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pending document list (local, not yet uploaded) */}
          {pendingDocs.length > 0 && (
            <div className="space-y-2">
              {pendingDocs.map((doc) => {
                const Icon = getFileIcon(doc.fileType);
                const badge = getTypeBadge(doc.fileType);
                const isMedia = isMediaType(doc.fileType);

                return (
                  <div
                    key={doc.id}
                    className="rounded-lg bg-muted/30 overflow-hidden"
                  >
                    {/* File header */}
                    <div className="flex items-center justify-between px-3 py-2 group">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs truncate">{doc.name}</span>
                        {isMedia && (
                          <span className={`text-[9px] px-1.5 py-0 rounded-full border font-medium ${badge.className}`}>
                            {badge.label}
                          </span>
                        )}
                        {doc.size && (
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">
                            {formatSize(doc.size)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-muted-foreground">
                          @{doc.name}
                        </span>
                        <button
                          type="button"
                          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeDoc(doc.id)}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Metadata fields — description + "quando enviar". Shown for
                        documents (PDF) and media alike; for documents the
                        description is optional (summary is auto-generated). */}
                    <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-medium text-muted-foreground">
                          {isMedia ? "Descricao do conteudo" : "Descricao (opcional)"}
                        </Label>
                        <Input
                          value={doc.description || ""}
                          onChange={(e) => updateDoc(doc.id, { description: e.target.value })}
                          placeholder={
                            isMedia
                              ? "Ex: Tabela de precos 2026 com planos e comparativo"
                              : "Ex: Catalogo completo de produtos 2026"
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-medium text-muted-foreground">Quando enviar</Label>
                        <Input
                          value={doc.sendWhen || ""}
                          onChange={(e) => updateDoc(doc.id, { sendWhen: e.target.value })}
                          placeholder={
                            isMedia
                              ? "Ex: Quando o lead perguntar sobre preco ou pedir proposta"
                              : "Ex: Quando o lead pedir o catalogo ou tabela de precos"
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== Links ===== */}
        <div className="space-y-2 pt-2 border-t">
          <Label className="text-sm flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            Links
          </Label>

          {/* Add link form */}
          <div className="flex gap-2">
            <Input
              value={newLinkAlias}
              onChange={(e) => setNewLinkAlias(e.target.value)}
              placeholder="Apelido (ex: site-precos)"
              className="h-8 text-xs flex-1"
            />
            <Input
              value={newLinkUrl}
              onChange={(e) => setNewLinkUrl(e.target.value)}
              placeholder="https://..."
              className="h-8 text-xs flex-[2]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={addLink}
              disabled={!newLinkAlias.trim() || !newLinkUrl.trim()}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Link list */}
          {links.length > 0 && (
            <div className="space-y-1">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-medium">{link.alias}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{link.url}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      @{link.alias}
                    </span>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeLink(link.id)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
