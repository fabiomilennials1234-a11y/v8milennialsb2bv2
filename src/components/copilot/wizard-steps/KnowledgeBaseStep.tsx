/**
 * Step: Base de Conhecimento (RAG - Approach B)
 *
 * Permite upload de documentos (PDF, TXT, MD, CSV, DOC/DOCX).
 * O resumo é gerado via LLM e injetado no prompt do agente.
 *
 * - Modo criação: documentos ficam em state local, uploadados após criar o agente.
 * - Modo edição: exibe documentos existentes (KnowledgeBaseManager) com upload/delete/reprocessar em tempo real.
 */

import { useState, useRef, useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { useParams } from "react-router-dom";
import {
  FileText,
  Upload,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CopilotWizardData } from "@/types/copilot";
import {
  useAgentDocuments,
  useUploadAgentDocument,
  useDeleteAgentDocument,
  useReprocessDocument,
} from "@/hooks/useAgentDocuments";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

const ACCEPTED_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("text/")) return "TXT";
  if (mimeType.includes("word")) return "DOC";
  return "FILE";
}

export function KnowledgeBaseStep() {
  const { id: editAgentId } = useParams<{ id: string }>();
  const isEditMode = !!editAgentId;

  const { setValue, watch } = useFormContext<CopilotWizardData>();
  const knowledgeBaseFiles = watch("knowledgeBaseFiles") || [];
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hooks para modo edição
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const { data: existingDocs = [], isLoading: isLoadingDocs } = useAgentDocuments(editAgentId);
  const uploadDocument = useUploadAgentDocument();
  const deleteDocument = useDeleteAgentDocument();
  const reprocessDocument = useReprocessDocument();

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const currentFiles = knowledgeBaseFiles || [];
      const remaining = MAX_FILES - currentFiles.length;
      if (remaining <= 0) return;

      const validFiles = newFiles
        .filter((f) => {
          if (!ACCEPTED_TYPES.includes(f.type)) {
            console.warn(`Tipo não suportado: ${f.type}`);
            return false;
          }
          if (f.size > MAX_FILE_SIZE) {
            console.warn(`Arquivo muito grande: ${f.name}`);
            return false;
          }
          // Evitar duplicatas
          if (currentFiles.some((existing: File) => existing.name === f.name && existing.size === f.size)) {
            return false;
          }
          return true;
        })
        .slice(0, remaining);

      if (validFiles.length > 0) {
        setValue("knowledgeBaseFiles", [...currentFiles, ...validFiles], {
          shouldDirty: true,
        });
      }
    },
    [knowledgeBaseFiles, setValue]
  );

  const removeFile = useCallback(
    (index: number) => {
      const current = [...(knowledgeBaseFiles || [])];
      current.splice(index, 1);
      setValue("knowledgeBaseFiles", current, { shouldDirty: true });
    },
    [knowledgeBaseFiles, setValue]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      addFiles(files);
    },
    [addFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      addFiles(files);
      // Reset input para permitir re-upload do mesmo arquivo
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addFiles]
  );

  // Handlers para modo edição (upload/delete/reprocess em tempo real)
  const handleEditUpload = useCallback(
    (file: File) => {
      if (!editAgentId || !organizationId) return;
      uploadDocument.mutate({
        agentId: editAgentId,
        organizationId,
        file,
      });
    },
    [editAgentId, organizationId, uploadDocument]
  );

  const handleEditDelete = useCallback(
    (docId: string, filePath: string) => {
      if (!editAgentId) return;
      deleteDocument.mutate({
        documentId: docId,
        filePath,
        agentId: editAgentId,
      });
    },
    [editAgentId, deleteDocument]
  );

  const handleEditReprocess = useCallback(
    (docId: string) => {
      if (!editAgentId) return;
      reprocessDocument.mutate({
        documentId: docId,
        agentId: editAgentId,
      });
    },
    [editAgentId, reprocessDocument]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" />
          Base de Conhecimento
        </h2>
        <p className="text-muted-foreground">
          Envie documentos sobre sua empresa, produtos ou serviços. O agente usará
          um resumo inteligente para responder com mais contexto e precisão.
        </p>
      </div>

      {/* Modo edição: documentos existentes */}
      {isEditMode && (
        <KnowledgeBaseManager
          documents={existingDocs}
          isLoading={isLoadingDocs}
          onUpload={handleEditUpload}
          onDelete={handleEditDelete}
          onReprocess={handleEditReprocess}
          uploadPending={uploadDocument.isPending}
        />
      )}

      {/* Modo criação: drop zone + lista local */}
      {!isEditMode && (
        <>
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }
              ${knowledgeBaseFiles.length >= MAX_FILES ? "opacity-50 pointer-events-none" : ""}
            `}
          >
            <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">
              Arraste arquivos aqui ou clique para selecionar
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PDF, TXT, MD, CSV, DOC/DOCX — Máx. 10MB por arquivo — Até {MAX_FILES}{" "}
              documentos
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          {/* Lista de arquivos */}
          {knowledgeBaseFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {knowledgeBaseFiles.length} documento{knowledgeBaseFiles.length > 1 ? "s" : ""} selecionado{knowledgeBaseFiles.length > 1 ? "s" : ""}
              </p>
              {knowledgeBaseFiles.map((file: File, index: number) => (
                <Card key={`${file.name}-${index}`} className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-muted-foreground">
                      {getFileIcon(file.type)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-yellow-500 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Será processado após criar
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Info */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          <strong className="text-blue-500">Como funciona:</strong> {isEditMode
            ? "Documentos enviados são processados por IA para gerar um resumo inteligente. Esse resumo é usado pelo agente nas conversas para responder com conhecimento específico da sua empresa."
            : "Após criar o copilot, cada documento é processado por IA para gerar um resumo inteligente. Esse resumo é injetado no prompt do agente, permitindo que ele responda com conhecimento específico da sua empresa."
          }
        </p>
      </div>
    </div>
  );
}

/**
 * Componente para gerenciar documentos de um agente já criado (edição)
 */
export function KnowledgeBaseManager({
  documents,
  isLoading,
  onUpload,
  onDelete,
  onReprocess,
  uploadPending,
}: {
  documents: Array<{
    id: string;
    file_name: string;
    file_size: number | null;
    mime_type: string | null;
    status: string | null;
    summary: string | null;
    error_message: string | null;
    file_path: string;
  }>;
  isLoading: boolean;
  onUpload: (file: File) => void;
  onDelete: (docId: string, filePath: string) => void;
  onReprocess: (docId: string) => void;
  uploadPending: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusIcon = (status: string | null) => {
    switch (status) {
      case "ready":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "processing":
        return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />;
    }
  };

  const statusLabel = (status: string | null) => {
    switch (status) {
      case "ready":
        return "Pronto";
      case "processing":
        return "Processando...";
      case "error":
        return "Erro";
      default:
        return "Pendente";
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files[0]) onUpload(files[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"}
          ${uploadPending ? "opacity-50 pointer-events-none" : ""}
        `}
      >
        {uploadPending ? (
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-primary" />
        ) : (
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
        )}
        <p className="text-sm">
          {uploadPending ? "Enviando..." : "Arraste ou clique para enviar novo documento"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, TXT, MD, CSV, DOC/DOCX — Máx. 10MB por arquivo
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* Lista de documentos */}
      {isLoading ? (
        <div className="text-center py-4">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhum documento enviado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {documents.length} documento{documents.length > 1 ? "s" : ""} salvo{documents.length > 1 ? "s" : ""}
          </p>
          {documents.map((doc) => (
            <Card key={doc.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {doc.file_size && <span>{formatFileSize(doc.file_size)}</span>}
                    <span className="flex items-center gap-1">
                      {statusIcon(doc.status)}
                      {statusLabel(doc.status)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {doc.status === "error" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onReprocess(doc.id)}
                    >
                      Reprocessar
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onDelete(doc.id, doc.file_path)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {doc.status === "error" && doc.error_message && (
                <p className="text-xs text-red-500 mt-2 pl-13">
                  {doc.error_message}
                </p>
              )}
              {doc.status === "ready" && doc.summary && (
                <details className="mt-2 pl-13">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    Ver resumo gerado
                  </summary>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                    {doc.summary}
                  </p>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
