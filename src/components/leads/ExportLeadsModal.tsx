import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useExportLeads } from "@/hooks/useExportLeads";
import { toast } from "sonner";
import { FileDown, Loader2, FileSpreadsheet, FileText } from "lucide-react";
import { useCanDo } from "@/modules/identity";
const EXPORT_LIMITS = [
  { value: 100, label: "Os 100 mais recentes" },
  { value: 500, label: "Os 500 mais recentes" },
  { value: 1000, label: "Os 1.000 mais recentes" },
  { value: 5000, label: "Os 5.000 mais recentes" },
  { value: 10000, label: "Os 10.000 mais recentes" },
  { value: 50000, label: "Todos (até 50.000)" },
] as const;

type ExportFormat = "csv" | "xlsx";

interface ExportLeadsContentProps {
  onDone?: () => void;
}

export function ExportLeadsContent({ onDone }: ExportLeadsContentProps) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [limit, setLimit] = useState<number>(5000);
  const { exportLeads, isExporting } = useExportLeads();
  const { allowed: canExport } = useCanDo("export_leads");

  const handleExport = async () => {
    if (!canExport) {
      toast.error("Você não tem permissão para exportar leads");
      return;
    }
    try {
      const { count } = await exportLeads({
        format,
        limit: limit === 50000 ? 50_000 : limit,
      });
      toast.success(`${count} leads exportados com sucesso.`);
      onDone?.();
    } catch (e) {
      console.error("Export error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao exportar. Tente novamente.");
    }
  };

  return (
    <div className="space-y-6 py-2">
      <div className="space-y-3">
        <Label>Formato</Label>
        <RadioGroup
          value={format}
          onValueChange={(v) => setFormat(v as ExportFormat)}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="xlsx" id="fmt-xlsx" />
            <Label htmlFor="fmt-xlsx" className="flex items-center gap-2 font-normal cursor-pointer">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
              Excel (.xlsx)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="csv" id="fmt-csv" />
            <Label htmlFor="fmt-csv" className="flex items-center gap-2 font-normal cursor-pointer">
              <FileText className="w-4 h-4 text-muted-foreground" />
              CSV
            </Label>
          </div>
        </RadioGroup>
      </div>
      <div className="space-y-3">
        <Label>Quantidade (os mais recentes)</Label>
        <RadioGroup
          value={String(limit)}
          onValueChange={(v) => setLimit(Number(v))}
          className="grid grid-cols-1 gap-2"
        >
          {EXPORT_LIMITS.map((opt) => (
            <div key={opt.value} className="flex items-center gap-2">
              <RadioGroupItem value={String(opt.value)} id={`limit-${opt.value}`} />
              <Label htmlFor={`limit-${opt.value}`} className="font-normal cursor-pointer">
                {opt.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <p className="text-xs text-muted-foreground">
        O arquivo inclui todos os dados: lead (nome, empresa, contato, prioridade, origem, UTMs, datas),
        etapa e datas de cada pipe (WhatsApp, Confirmação, Propostas), valores, responsáveis e notas.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => onDone?.()} disabled={isExporting}>
          Cancelar
        </Button>
        <Button onClick={handleExport} disabled={isExporting || !canExport}>
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
    </div>
  );
}

interface ExportLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportLeadsModal({ open, onOpenChange }: ExportLeadsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5 text-primary" />
            Exportar leads
          </DialogTitle>
        </DialogHeader>
        <ExportLeadsContent onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
