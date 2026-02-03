import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useExportLeads } from "@/hooks/useExportLeads";
import { toast } from "sonner";
import { FileDown, Loader2, FileSpreadsheet, FileText } from "lucide-react";

const EXPORT_LIMITS = [
  { value: 100, label: "Os 100 mais recentes" },
  { value: 500, label: "Os 500 mais recentes" },
  { value: 1000, label: "Os 1.000 mais recentes" },
  { value: 5000, label: "Os 5.000 mais recentes" },
  { value: 10000, label: "Os 10.000 mais recentes" },
  { value: 50000, label: "Todos (até 50.000)" },
] as const;

type ExportFormat = "csv" | "xlsx";

interface ExportLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportLeadsModal({ open, onOpenChange }: ExportLeadsModalProps) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [limit, setLimit] = useState<number>(5000);
  const { exportLeads, isExporting } = useExportLeads();

  const handleExport = async () => {
    try {
      const { count } = await exportLeads({
        format,
        limit: limit === 50000 ? 50_000 : limit,
      });
      toast.success(`${count} leads exportados com sucesso.`);
      onOpenChange(false);
    } catch (e) {
      console.error("Export error:", e);
      toast.error("Erro ao exportar. Tente novamente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5 text-primary" />
            Exportar leads
          </DialogTitle>
        </DialogHeader>
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
            O arquivo exportado usa o mesmo modelo de colunas da importação (Nome, Empresa, Email, Telefone, etc.),
            para você poder editar e importar novamente se quiser.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
              Cancelar
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
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
      </DialogContent>
    </Dialog>
  );
}
