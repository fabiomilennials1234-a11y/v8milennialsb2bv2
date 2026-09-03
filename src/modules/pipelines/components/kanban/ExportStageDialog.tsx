import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useExportLeads } from "@/modules/leads";
import { useCanDo } from "@/modules/identity";
import { toast } from "sonner";
import { FileDown, Loader2, FileSpreadsheet, FileText } from "lucide-react";

type ExportFormat = "csv" | "xlsx";

interface ExportStageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageId: string;
  stageTitle: string;
  /**
   * SCRUM-633/637 — modo único: a etapa é endereçada por
   * (pipelines.id, pipeline_stages.id) e o resolve acontece direto em
   * `pipeline_entries`, servindo QUALQUER funil. Os modos por slug morreram
   * no flip junto com as páginas que os usavam.
   */
  pipelineId: string;
  /** Quantidade de leads visíveis no Kanban para exibir no diálogo. */
  leadCount: number;
}

/**
 * Diálogo para exportar leads de uma única etapa do Kanban.
 * Reusa `useExportLeads` com `stageFilter` para garantir o mesmo schema do
 * arquivo da exportação global (SCRUM-635: bloco do lead + um bloco por funil
 * REAL da org — não mais os 3 pipes fixos).
 */
export function ExportStageDialog({
  open,
  onOpenChange,
  stageId,
  stageTitle,
  pipelineId,
  leadCount,
}: ExportStageDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const { exportLeads, isExporting } = useExportLeads();
  const { allowed: canExport } = useCanDo("export_leads");

  // Reset format ao abrir/fechar para evitar estado vazado entre etapas.
  useEffect(() => {
    if (open) setFormat("csv");
  }, [open]);

  const isEmpty = leadCount === 0;
  const disabled = isExporting || !canExport || isEmpty;

  const handleExport = async () => {
    if (!canExport) {
      toast.error("Você não tem permissão para exportar leads");
      return;
    }
    if (isEmpty) return;
    try {
      const { count } = await exportLeads({
        format,
        stageFilter: { pipelineId, stageId },
        stageTitle,
      });
      if (count === 0) {
        toast.message("Nenhum lead nesta etapa para exportar.");
      } else {
        toast.success(`${count} lead${count === 1 ? "" : "s"} exportado${count === 1 ? "" : "s"} com sucesso.`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar. Tente novamente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isExporting) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5 text-primary" />
            Exportar leads da etapa
          </DialogTitle>
          <DialogDescription>
            {isEmpty
              ? `Nenhum lead em "${stageTitle}".`
              : `${leadCount} lead${leadCount === 1 ? "" : "s"} em "${stageTitle}".`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Formato
            </Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              className="grid grid-cols-1 gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="csv" id="export-stage-fmt-csv" />
                <Label
                  htmlFor="export-stage-fmt-csv"
                  className="flex items-center gap-2 font-normal cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  CSV
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="xlsx" id="export-stage-fmt-xlsx" />
                <Label
                  htmlFor="export-stage-fmt-xlsx"
                  className="flex items-center gap-2 font-normal cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                  Excel (.xlsx)
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancelar
          </Button>
          <Button onClick={handleExport} disabled={disabled}>
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exportando...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4 mr-2" />
                Exportar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
