import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import * as XLSX from "xlsx";

/** Modelo de colunas para exportação (compatível com importação). */
export const EXPORT_LEAD_HEADERS = [
  "Nome",
  "Empresa",
  "Email",
  "Telefone",
  "Faturamento",
  "Segmento",
  "Notas",
  "Prioridade do lead",
  "Público de origem",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
  "Data criação",
] as const;

type ExportFormat = "csv" | "xlsx";

export interface ExportLeadsOptions {
  format: ExportFormat;
  /** Limite de leads (os mais recentes). Se não informado, exporta até 10.000. */
  limit?: number;
}

export interface UseExportLeadsResult {
  exportLeads: (options: ExportLeadsOptions) => Promise<{ count: number }>;
  isExporting: boolean;
}

/** Prioridade numérica → label para exportação */
function ratingToLabel(rating: number | null | undefined): string {
  if (rating == null) return "";
  if (rating >= 9) return "Máxima";
  if (rating >= 7) return "Alta";
  if (rating >= 4) return "Média";
  if (rating >= 1) return "Baixa";
  return "";
}

export function useExportLeads(): UseExportLeadsResult {
  const [isExporting, setIsExporting] = useState(false);
  const { organizationId } = useOrganization();

  const exportLeads = async (options: ExportLeadsOptions): Promise<{ count: number }> => {
    if (!organizationId) {
      throw new Error("Organização não encontrada");
    }
    setIsExporting(true);
    try {
      const limit = Math.min(options.limit ?? 10_000, 50_000);
      const { data: leads, error } = await supabase
        .from("leads")
        .select(
          "id, name, company, email, phone, faturamento, segment, notes, rating, origin, utm_campaign, utm_source, utm_medium, utm_content, utm_term, created_at"
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      const rows = (leads || []).map((row: Record<string, unknown>) => ({
        Nome: row.name ?? "",
        Empresa: row.company ?? "",
        Email: row.email ?? "",
        Telefone: row.phone ?? "",
        Faturamento: row.faturamento ?? "",
        Segmento: row.segment ?? "",
        Notas: row.notes ?? "",
        "Prioridade do lead": ratingToLabel(row.rating as number),
        "Público de origem": row.origin ?? "",
        utm_campaign: row.utm_campaign ?? "",
        utm_source: row.utm_source ?? "",
        utm_medium: row.utm_medium ?? "",
        utm_content: row.utm_content ?? "",
        utm_term: row.utm_term ?? "",
        "Data criação":
          row.created_at != null
            ? new Date(row.created_at as string).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : "",
      }));

      const filename = `leads_export_${new Date().toISOString().slice(0, 10)}`;

      if (options.format === "csv") {
        const header = EXPORT_LEAD_HEADERS.join(",");
        const escape = (v: string) => {
          const s = String(v ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const lines = [header, ...rows.map((r) => EXPORT_LEAD_HEADERS.map((h) => escape((r as Record<string, string>)[h])).join(","))];
        const csv = lines.join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_LEAD_HEADERS] });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leads");
        XLSX.writeFile(wb, `${filename}.xlsx`);
      }

      return { count: rows.length };
    } finally {
      setIsExporting(false);
    }
  };

  return { exportLeads, isExporting };
}
