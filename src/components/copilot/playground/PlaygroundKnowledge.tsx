/**
 * PlaygroundKnowledge — Base de Conhecimento
 *
 * - Upload de documentos (PDF, DOC, TXT, imagens)
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
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { KnowledgeDocument, KnowledgeLink } from "./types";

interface ExistingDocument {
  id: string;
  file_name: string;
  file_size: number | null;
  status: string | null;
  summary: string | null;
  error_message: string | null;
  file_path: string;
}

interface PlaygroundKnowledgeProps {
  documents: KnowledgeDocument[];
  links: KnowledgeLink[];
  onDocumentsChange: (docs: KnowledgeDocument[]) => void;
  onLinksChange: (links: KnowledgeLink[]) => void;
  existingDocuments?: ExistingDocument[];
  onDeleteExisting?: (docId: string, filePath: string) => void;
}

const ACCEPTED_TYPES = ".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return Image;
  return File;
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function PlaygroundKnowledge({
  documents,
  links,
  onDocumentsChange,
  onLinksChange,
  existingDocuments = [],
  onDeleteExisting,
}: PlaygroundKnowledgeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newLinkAlias, setNewLinkAlias] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  const docCount = documents.length + existingDocuments.length;
  const linkCount = links.length;

  // Handle file upload
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const newDocs: KnowledgeDocument[] = Array.from(files).map((file) => ({
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        file,
        size: file.size,
        status: "pending",
      }));
      onDocumentsChange([...documents, ...newDocs]);
    },
    [documents, onDocumentsChange]
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
        {/* ===== Documents ===== */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Documentos
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
              PDF, DOC, TXT, imagens (PNG, JPG)
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
              {existingDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs truncate">{doc.file_name}</span>
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
              ))}
            </div>
          )}

          {/* Pending document list (local, not yet uploaded) */}
          {documents.length > 0 && (
            <div className="space-y-1">
              {documents.map((doc) => {
                const Icon = getFileIcon(doc.name);
                return (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs truncate">{doc.name}</span>
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
