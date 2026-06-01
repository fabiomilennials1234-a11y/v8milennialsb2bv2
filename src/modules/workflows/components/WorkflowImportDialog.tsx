// src/components/automacoes/WorkflowImportDialog.tsx

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileJson,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ImportReport } from "@/types/workflowPortability";

interface WorkflowImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (jsonString: string) => void;
  isImporting: boolean;
  report: ImportReport | null;
}

const STATUS_CONFIG = {
  success: { icon: CheckCircle2, color: "text-green-500" },
  warning: { icon: AlertTriangle, color: "text-yellow-500" },
  pending: { icon: Clock, color: "text-orange-500" },
};

export function WorkflowImportDialog({
  open,
  onClose,
  onImport,
  isImporting,
  report,
}: WorkflowImportDialogProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFileName(file.name);

    if (!file.name.endsWith(".json")) {
      setFileError("Apenas arquivos .json são aceitos.");
      setFileContent(null);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFileError("Arquivo muito grande (máximo 5MB).");
      setFileContent(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileContent(ev.target?.result as string);
    };
    reader.onerror = () => {
      setFileError("Erro ao ler o arquivo.");
    };
    reader.readAsText(file);
  }, []);

  const handleImport = useCallback(() => {
    if (!fileContent) return;
    onImport(fileContent);
  }, [fileContent, onImport]);

  const handleClose = useCallback(() => {
    setFileName(null);
    setFileContent(null);
    setFileError(null);
    onClose();
  }, [onClose]);

  const handleGoToWorkflow = useCallback(() => {
    if (report?.workflowId) {
      handleClose();
      navigate(`/automacoes/${report.workflowId}`);
    }
  }, [report, handleClose, navigate]);

  // Report view
  if (report) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Workflow Importado
            </DialogTitle>
            <DialogDescription>
              "{report.workflowName}" — {report.totalNodes} nós
              {report.unresolvedCount > 0 && (
                <span className="text-orange-500 ml-1">
                  ({report.unresolvedCount} pendência{report.unresolvedCount > 1 ? "s" : ""})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-4">
              {report.items.map((item, idx) => {
                const config = STATUS_CONFIG[item.status];
                const Icon = config.icon;
                return (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.color}`} />
                    <span className="text-muted-foreground">{item.message}</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleClose}>
              Fechar
            </Button>
            <Button onClick={handleGoToWorkflow}>
              Abrir Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Upload view
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Workflow</DialogTitle>
          <DialogDescription>
            Selecione um arquivo .json exportado de outra organização.
            O workflow será criado como inativo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
          >
            {fileName ? (
              <>
                <FileJson className="w-8 h-8" />
                <span className="text-sm font-medium">{fileName}</span>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8" />
                <span className="text-sm">Clique para selecionar arquivo .json</span>
              </>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelect}
          />

          {fileError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4" />
              {fileError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!fileContent || isImporting || !!fileError}
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-1" />
                Importar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
