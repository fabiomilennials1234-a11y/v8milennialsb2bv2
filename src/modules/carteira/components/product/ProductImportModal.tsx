import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useOrganization } from "@/modules/identity";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, FileSpreadsheet, RefreshCw } from "lucide-react";
import { invalidateProductQueries, type ProductType } from "@/modules/carteira/hooks/useProducts";

// -- System fields that the user can map spreadsheet columns to --
const SYSTEM_FIELDS = [
  { key: "sku", label: "SKU", required: false, scope: "both" },
  { key: "parent_sku", label: "SKU do Produto-Pai", required: false, scope: "variant" },
  { key: "name", label: "Nome", required: true, scope: "both" },
  { key: "type", label: "Tipo (recorrencia/projeto/unitario)", required: false, scope: "product" },
  { key: "description", label: "Descrição", required: false, scope: "product" },
  { key: "base_unit", label: "Unidade Base", required: false, scope: "product" },
  { key: "ticket", label: "Ticket (R$)", required: false, scope: "both" },
  { key: "ticket_minimo", label: "Ticket Mínimo (R$)", required: false, scope: "both" },
  { key: "entregaveis", label: "Entregáveis", required: false, scope: "product" },
  { key: "materiais", label: "Materiais", required: false, scope: "product" },
  { key: "links", label: "Links (separados por ;)", required: false, scope: "product" },
  { key: "logo_url", label: "URL do Logo", required: false, scope: "product" },
  { key: "contrato_padrao_url", label: "URL Contrato Padrão", required: false, scope: "product" },
  { key: "contrato_minimo_url", label: "URL Contrato Mínimo", required: false, scope: "product" },
  { key: "weight", label: "Peso (kg)", required: false, scope: "variant" },
  { key: "grammage", label: "Gramatura (g/m²)", required: false, scope: "variant" },
  { key: "dimensions", label: "Dimensões", required: false, scope: "variant" },
  { key: "color", label: "Cor", required: false, scope: "variant" },
  { key: "size", label: "Tamanho", required: false, scope: "variant" },
  { key: "is_active", label: "Ativo (sim/não)", required: false, scope: "both" },
] as const;

type SystemFieldKey = (typeof SYSTEM_FIELDS)[number]["key"];

const VALID_TYPES: ProductType[] = ["mrr", "projeto", "unitario"];

// -- Helpers --
function parseLinks(value: unknown): string[] | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.split(";").map((u) => u.trim()).filter(Boolean) || null;
}

function parseBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  const s = String(value).toLowerCase();
  return s === "sim" || s === "true" || s === "yes";
}

function parseNumeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function getString(row: Record<string, unknown>, mapping: Record<string, string>, field: string): string {
  const col = mapping[field];
  if (!col) return "";
  const v = row[col];
  if (v == null || v === "") return "";
  return String(v).trim();
}

function getVal(row: Record<string, unknown>, mapping: Record<string, string>, field: string): unknown {
  const col = mapping[field];
  if (!col) return undefined;
  return row[col];
}

async function sheetToRows(file: File): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const ExcelJS = await import("exceljs");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();

  if (file.name.endsWith(".csv")) {
    const text = new TextDecoder().decode(arrayBuffer);
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) throw new Error("Arquivo vazio");
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, unknown> = {};
      headers.forEach((h, j) => { row[h] = values[j] ?? ""; });
      rows.push(row);
    }
    return { rows, headers };
  }

  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) throw new Error("Arquivo vazio");

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, unknown>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) obj[header] = cell.value;
    });
    rows.push(obj);
  });

  return { rows, headers: headers.filter(Boolean) };
}

// -- Validation types --
interface ParsedRow {
  rowIndex: number;
  isVariant: boolean;
  error: string | null;
  productData?: {
    sku: string | null;
    name: string;
    type: ProductType;
    description: string | null;
    base_unit: string | null;
    ticket: number | null;
    ticket_minimo: number | null;
    entregaveis: string | null;
    materiais: string | null;
    links: string[] | null;
    logo_url: string | null;
    contrato_padrao_url: string | null;
    contrato_minimo_url: string | null;
    is_active: boolean;
  };
  variantData?: {
    parent_sku: string;
    sku: string | null;
    name: string;
    ticket: number | null;
    ticket_minimo: number | null;
    weight: number | null;
    grammage: number | null;
    dimensions: string | null;
    color: string | null;
    size: string | null;
    is_active: boolean;
  };
}

function parseRowMapped(row: Record<string, unknown>, rowIndex: number, mapping: Record<string, string>): ParsedRow {
  const parentSku = getString(row, mapping, "parent_sku");
  const isVariant = !!parentSku;
  const name = getString(row, mapping, "name");

  if (!name) return { rowIndex, isVariant, error: "Nome é obrigatório" };

  if (isVariant) {
    return {
      rowIndex,
      isVariant: true,
      error: null,
      variantData: {
        parent_sku: parentSku,
        sku: getString(row, mapping, "sku") || null,
        name,
        ticket: parseNumeric(getVal(row, mapping, "ticket")),
        ticket_minimo: parseNumeric(getVal(row, mapping, "ticket_minimo")),
        weight: parseNumeric(getVal(row, mapping, "weight")),
        grammage: parseNumeric(getVal(row, mapping, "grammage")),
        dimensions: getString(row, mapping, "dimensions") || null,
        color: getString(row, mapping, "color") || null,
        size: getString(row, mapping, "size") || null,
        is_active: getVal(row, mapping, "is_active") === undefined ? true : parseBool(getVal(row, mapping, "is_active")),
      },
    };
  }

  const typeRaw = getString(row, mapping, "type").toLowerCase() || "unitario";
  if (!VALID_TYPES.includes(typeRaw as ProductType)) {
    return { rowIndex, isVariant: false, error: `Tipo inválido: "${typeRaw}". Use: ${VALID_TYPES.join(", ")}` };
  }

  return {
    rowIndex,
    isVariant: false,
    error: null,
    productData: {
      sku: getString(row, mapping, "sku") || null,
      name,
      type: typeRaw as ProductType,
      description: getString(row, mapping, "description") || null,
      base_unit: getString(row, mapping, "base_unit") || null,
      ticket: parseNumeric(getVal(row, mapping, "ticket")),
      ticket_minimo: parseNumeric(getVal(row, mapping, "ticket_minimo")),
      entregaveis: getString(row, mapping, "entregaveis") || null,
      materiais: getString(row, mapping, "materiais") || null,
      links: parseLinks(getVal(row, mapping, "links")),
      logo_url: getString(row, mapping, "logo_url") || null,
      contrato_padrao_url: getString(row, mapping, "contrato_padrao_url") || null,
      contrato_minimo_url: getString(row, mapping, "contrato_minimo_url") || null,
      is_active: getVal(row, mapping, "is_active") === undefined ? true : parseBool(getVal(row, mapping, "is_active")),
    },
  };
}

// -- Component --
interface ProductImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "mapping" | "preview";

export function ProductImportModal({ open, onOpenChange }: ProductImportModalProps) {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [isImporting, setIsImporting] = useState(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("Use um arquivo .xlsx, .xls ou .csv");
      return;
    }
    setFile(f);
    try {
      const { rows, headers: h } = await sheetToRows(f);
      if (rows.length === 0) {
        toast.error("Nenhuma linha de dados no arquivo");
        return;
      }
      setRawRows(rows);
      setHeaders(h);

      // Auto-map columns with matching names
      const autoMapping: Record<string, string> = {};
      for (const field of SYSTEM_FIELDS) {
        const match = h.find(
          (col) => col.toLowerCase().replace(/[^a-z0-9]/g, "") === field.key.toLowerCase().replace(/[^a-z0-9]/g, "")
        );
        if (match) autoMapping[field.key] = match;
      }
      setMapping(autoMapping);
      setStep("mapping");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao ler o arquivo");
    }
  }, []);

  const handleApplyMapping = () => {
    if (!mapping["name"]) {
      toast.error("O campo 'Nome' é obrigatório. Mapeie-o para uma coluna.");
      return;
    }
    const results = rawRows.map((row, i) => parseRowMapped(row, i + 2, mapping));

    // Validate variant parent_sku references
    const productSkus = new Set(results.filter((r) => !r.isVariant && r.productData?.sku).map((r) => r.productData!.sku!));
    for (const r of results) {
      if (r.isVariant && r.variantData && !r.error) {
        if (!productSkus.has(r.variantData.parent_sku)) {
          r.error = `SKU pai "${r.variantData.parent_sku}" não encontrado na planilha`;
        }
      }
    }

    setParsedRows(results);
    setStep("preview");
  };

  const validProducts = parsedRows.filter((r) => !r.isVariant && !r.error && r.productData);
  const validVariants = parsedRows.filter((r) => r.isVariant && !r.error && r.variantData);
  const invalidCount = parsedRows.filter((r) => r.error).length;

  const handleConfirmImport = async () => {
    if (!organizationId) return;
    setIsImporting(true);
    try {
      let productsImported = 0;
      let variantsImported = 0;
      let productsUpdated = 0;

      // 1. Get existing products by SKU for upsert
      const skusToCheck = validProducts.filter((r) => r.productData?.sku).map((r) => r.productData!.sku!);
      let existingBysku: Record<string, string> = {};
      if (skusToCheck.length > 0) {
        const { data: existing } = await supabase
          .from("products")
          .select("id, sku")
          .eq("organization_id", organizationId)
          .in("sku", skusToCheck);
        if (existing) {
          existingBysku = Object.fromEntries(existing.map((p) => [p.sku, p.id]));
        }
      }

      // 2. Process products — update existing, insert new
      const skuToId: Record<string, string> = { ...existingBysku };
      const toInsert: typeof validProducts = [];
      const toUpdate: typeof validProducts = [];

      for (const r of validProducts) {
        if (r.productData?.sku && existingBysku[r.productData.sku]) {
          toUpdate.push(r);
        } else {
          toInsert.push(r);
        }
      }

      // Insert new products
      if (toInsert.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < toInsert.length; i += batchSize) {
          const chunk = toInsert.slice(i, i + batchSize).map((r) => ({
            ...r.productData!,
            has_variants: false,
            organization_id: organizationId,
          }));
          const { data, error } = await supabase.from("products").insert(chunk).select("id, sku");
          if (error) throw error;
          if (data) {
            for (const p of data) {
              if (p.sku) skuToId[p.sku] = p.id;
            }
          }
          productsImported += chunk.length;
        }
      }

      // Update existing products
      for (const r of toUpdate) {
        const id = existingBysku[r.productData!.sku!];
        const { error } = await supabase
          .from("products")
          .update({ ...r.productData!, organization_id: organizationId })
          .eq("id", id);
        if (error) throw error;
        productsUpdated++;
      }

      // 3. Process variants
      if (validVariants.length > 0) {
        // Mark parent products as has_variants
        const parentSkus = [...new Set(validVariants.map((r) => r.variantData!.parent_sku))];
        for (const psku of parentSkus) {
          const pid = skuToId[psku];
          if (pid) {
            await supabase.from("products").update({ has_variants: true }).eq("id", pid);
          }
        }

        // Check existing variant SKUs
        const variantSkus = validVariants.filter((r) => r.variantData?.sku).map((r) => r.variantData!.sku!);
        let existingVariantsBysku: Record<string, string> = {};
        if (variantSkus.length > 0) {
          const { data: ev } = await supabase
            .from("product_variants")
            .select("id, sku")
            .eq("organization_id", organizationId)
            .in("sku", variantSkus);
          if (ev) {
            existingVariantsBysku = Object.fromEntries(ev.map((v) => [v.sku, v.id]));
          }
        }

        // Insert/update variants
        for (const r of validVariants) {
          const vd = r.variantData!;
          const productId = skuToId[vd.parent_sku];
          if (!productId) continue;

          const payload = {
            product_id: productId,
            sku: vd.sku,
            name: vd.name,
            ticket: vd.ticket,
            ticket_minimo: vd.ticket_minimo,
            weight: vd.weight,
            grammage: vd.grammage,
            dimensions: vd.dimensions,
            color: vd.color,
            size: vd.size,
            custom_attributes: {},
            sort_order: 0,
            is_active: vd.is_active,
            organization_id: organizationId,
          };

          if (vd.sku && existingVariantsBysku[vd.sku]) {
            await supabase.from("product_variants").update(payload).eq("id", existingVariantsBysku[vd.sku]);
          } else {
            await supabase.from("product_variants").insert(payload);
          }
          variantsImported++;
        }
      }

      invalidateProductQueries(queryClient);

      const parts: string[] = [];
      if (productsImported > 0) parts.push(`${productsImported} produto(s) criado(s)`);
      if (productsUpdated > 0) parts.push(`${productsUpdated} produto(s) atualizado(s)`);
      if (variantsImported > 0) parts.push(`${variantsImported} variação(ões) importada(s)`);
      toast.success(parts.join(", ") || "Nada para importar.");

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
    setRawRows([]);
    setHeaders([]);
    setMapping({});
    setParsedRows([]);
    setStep("upload");
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Produtos
          </DialogTitle>
        </DialogHeader>

        {!isReady || !organizationId ? (
          <p className="text-muted-foreground">Carregando organização...</p>
        ) : step === "upload" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Importe produtos e variações de um arquivo Excel ou CSV. Use a coluna <strong>parent_sku</strong> para indicar variações vinculadas a um produto-pai.
            </p>

            {/* Ações principais - sempre visíveis no topo */}
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
              <Button variant="outline" asChild>
                <label className="cursor-pointer">
                  <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFileChange} />
                  Selecionar arquivo
                </label>
              </Button>
              <span className="text-sm text-muted-foreground">ou</span>
              <Button variant="outline" asChild>
                <a href="/products_import_template.xlsx" download="products_import_template.xlsx">
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  Baixar modelo (.xlsx)
                </a>
              </Button>
            </div>

            <div className="bg-muted/50 border rounded-lg p-4 text-sm space-y-2">
              <p className="font-medium">Colunas suportadas:</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                {SYSTEM_FIELDS.map((f) => (
                  <span key={f.key}>
                    <code>{f.key}</code> — {f.label} {f.required && <Badge variant="destructive" className="text-[10px] px-1">obrigatório</Badge>}
                  </span>
                ))}
              </div>
              <p className="text-xs mt-2">
                Linhas <strong>sem</strong> parent_sku = produto-pai. Linhas <strong>com</strong> parent_sku = variação.
                Se o SKU já existir no sistema, o produto/variação será <strong>atualizado</strong>.
              </p>
            </div>
          </div>
        ) : step === "mapping" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Mapeie as colunas da sua planilha para os campos do sistema. Colunas com nomes reconhecidos já foram mapeadas automaticamente.
            </p>
            <div className="max-h-[400px] overflow-auto space-y-2">
              {SYSTEM_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <div className="w-[200px] text-sm flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-destructive">*</span>}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select
                    value={mapping[field.key] || "__none__"}
                    onValueChange={(val) =>
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (val === "__none__") delete next[field.key];
                        else next[field.key] = val;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="— Não mapear —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Não mapear —</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mapping[field.key] && (
                    <Badge variant="secondary" className="text-xs">
                      {rawRows[0] ? String(rawRows[0][mapping[field.key]] ?? "").slice(0, 30) : ""}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Trocar arquivo
              </Button>
              <Button onClick={handleApplyMapping}>
                Validar e Pré-visualizar <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3 text-sm">
              <Badge variant="default">{validProducts.length} produto(s)</Badge>
              <Badge variant="secondary">{validVariants.length} variação(ões)</Badge>
              {invalidCount > 0 && <Badge variant="destructive">{invalidCount} erro(s)</Badge>}
            </div>
            <div className="max-h-[350px] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">Linha</th>
                    <th className="text-left p-2">Tipo</th>
                    <th className="text-left p-2">SKU</th>
                    <th className="text-left p-2">Nome</th>
                    <th className="text-left p-2">Ticket</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((r) => (
                    <tr key={r.rowIndex} className="border-t">
                      <td className="p-2">{r.rowIndex}</td>
                      <td className="p-2">
                        <Badge variant={r.isVariant ? "outline" : "default"} className="text-xs">
                          {r.isVariant ? "Variação" : "Produto"}
                        </Badge>
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {r.isVariant ? r.variantData?.sku : r.productData?.sku ?? "—"}
                      </td>
                      <td className="p-2">
                        {r.isVariant ? r.variantData?.name : r.productData?.name ?? "—"}
                      </td>
                      <td className="p-2">
                        {r.isVariant
                          ? (r.variantData?.ticket != null ? `R$ ${r.variantData.ticket}` : "—")
                          : (r.productData?.ticket != null ? `R$ ${r.productData.ticket}` : "—")}
                      </td>
                      <td className="p-2">
                        {r.error ? (
                          <span className="text-destructive text-xs">{r.error}</span>
                        ) : (
                          <span className="text-green-600 text-xs">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("mapping")}>
                  Voltar ao mapeamento
                </Button>
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Trocar arquivo
                </Button>
              </div>
              <Button
                onClick={handleConfirmImport}
                disabled={(validProducts.length === 0 && validVariants.length === 0) || isImporting}
              >
                {isImporting ? (
                  <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Importando...</>
                ) : (
                  `Confirmar importação (${validProducts.length + validVariants.length})`
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
