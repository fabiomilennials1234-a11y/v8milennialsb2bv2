import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/useOrganization";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import type { ProductType } from "@/hooks/useProducts";

const TEMPLATE_HEADERS = [
  "name",
  "type",
  "ticket",
  "ticket_minimo",
  "entregaveis",
  "materiais",
  "links",
  "logo_url",
  "contrato_padrao_url",
  "contrato_minimo_url",
  "is_active",
] as const;

const VALID_TYPES: ProductType[] = ["mrr", "projeto", "unitario"];

export interface ParsedProductRow {
  name: string;
  type: ProductType;
  ticket: number | null;
  ticket_minimo: number | null;
  entregaveis: string | null;
  materiais: string | null;
  links: string[] | null;
  logo_url: string | null;
  contrato_padrao_url: string | null;
  contrato_minimo_url: string | null;
  is_active: boolean;
}

export interface RowValidation {
  rowIndex: number;
  data: ParsedProductRow | null;
  error: string | null;
}

function parseLinks(value: unknown): string[] | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.split(";").map((u) => u.trim()).filter(Boolean) || null;
}

function parseBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1" || String(value).toLowerCase() === "sim" || String(value).toLowerCase() === "true") return true;
  return false;
}

function parseNumeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRow(row: Record<string, unknown>, rowIndex: number): RowValidation {
  const get = (key: string) => {
    const v = row[key] ?? row[key.toLowerCase()];
    if (v != null && v !== "") return String(v).trim();
    return "";
  };
  const name = get("name");
  const typeRaw = get("type").toLowerCase();

  if (!name) {
    return { rowIndex, data: null, error: "Nome é obrigatório" };
  }
  if (!VALID_TYPES.includes(typeRaw as ProductType)) {
    return { rowIndex, data: null, error: `Tipo deve ser: ${VALID_TYPES.join(", ")}` };
  }

  const data: ParsedProductRow = {
    name,
    type: typeRaw as ProductType,
    ticket: parseNumeric(row["ticket"]),
    ticket_minimo: parseNumeric(row["ticket_minimo"]),
    entregaveis: get("entregaveis") || null,
    materiais: get("materiais") || null,
    links: parseLinks(row["links"]),
    logo_url: get("logo_url") || null,
    contrato_padrao_url: get("contrato_padrao_url") || null,
    contrato_minimo_url: get("contrato_minimo_url") || null,
    is_active: row["is_active"] === undefined ? true : parseBool(row["is_active"]),
  };
  return { rowIndex, data, error: null };
}

function sheetToRows(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error("Arquivo vazio"));
          return;
        }
        let rows: Record<string, unknown>[];
        if (file.name.endsWith(".csv")) {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
          const workbook = XLSX.read(text, { type: "string", raw: true });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
        } else {
          const workbook = XLSX.read(data, { type: "binary" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
        }
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    if (file.name.endsWith(".csv")) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  });
}

interface ProductImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductImportModal({ open, onOpenChange }: ProductImportModalProps) {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [validations, setValidations] = useState<RowValidation[]>([]);
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [isImporting, setIsImporting] = useState(false);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (!["xlsx", "xls", "csv"].includes(ext || "")) {
        toast.error("Use um arquivo .xlsx, .xls ou .csv");
        return;
      }
      setFile(f);
      try {
        const rows = await sheetToRows(f);
        if (rows.length === 0) {
          toast.error("Nenhuma linha de dados no arquivo");
          setValidations([]);
          return;
        }
        const results: RowValidation[] = rows.map((row, i) => parseRow(row, i + 2));
        setValidations(results);
        setStep("preview");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao ler o arquivo");
        setValidations([]);
      }
    },
    []
  );

  const validRows = validations.filter((v) => v.error === null && v.data);
  const invalidCount = validations.filter((v) => v.error !== null).length;

  const handleConfirmImport = async () => {
    if (!organizationId || validRows.length === 0) return;
    setIsImporting(true);
    try {
      const batchSize = 50;
      let imported = 0;
      for (let i = 0; i < validRows.length; i += batchSize) {
        const chunk = validRows.slice(i, i + batchSize).map((v) => ({
          ...v.data!,
          organization_id: organizationId,
        }));
        const { error } = await supabase.from("products").insert(chunk);
        if (error) throw error;
        imported += chunk.length;
      }
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(`${imported} produto(s) importado(s) com sucesso.`);
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setValidations([]);
    setStep("upload");
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Importar produtos do Excel</DialogTitle>
        </DialogHeader>

        {!isReady || !organizationId ? (
          <p className="text-muted-foreground">Carregando organização...</p>
        ) : step === "upload" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use um arquivo .xlsx, .xls ou .csv com as colunas: name, type, ticket, ticket_minimo, entregaveis, materiais, links (separados por ;), logo_url, contrato_padrao_url, contrato_minimo_url, is_active.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                  Selecionar arquivo
                </label>
              </Button>
              <a
                href="/products_import_template.xlsx"
                download="products_import_template.xlsx"
                className="text-sm text-primary hover:underline"
              >
                Baixar modelo
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {validRows.length} linha(s) válida(s), {invalidCount} com erro.
            </p>
            <div className="max-h-[300px] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">Linha</th>
                    <th className="text-left p-2">Nome</th>
                    <th className="text-left p-2">Tipo</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {validations.map((v) => (
                    <tr key={v.rowIndex} className="border-t">
                      <td className="p-2">{v.rowIndex}</td>
                      <td className="p-2">{v.data?.name ?? "—"}</td>
                      <td className="p-2">{v.data?.type ?? "—"}</td>
                      <td className="p-2">
                        {v.error ? (
                          <span className="text-destructive">{v.error}</span>
                        ) : (
                          <span className="text-green-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Trocar arquivo
              </Button>
              <Button
                onClick={handleConfirmImport}
                disabled={validRows.length === 0 || isImporting}
              >
                {isImporting ? "Importando..." : `Confirmar importação (${validRows.length})`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
