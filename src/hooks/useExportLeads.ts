import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useCanDo } from "@/hooks/useCanDo";

const BATCH_SIZE = 500;

/** Cabeçalhos completos: lead + pipe Qualificação + pipe Confirmação + pipe Propostas */
export const EXPORT_LEAD_HEADERS = [
  // Lead
  "ID Lead",
  "Nome",
  "Empresa",
  "Email",
  "Telefone",
  "Faturamento",
  "Segmento",
  "Urgência",
  "Notas",
  "Prioridade do lead",
  "Público de origem",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
  "Data criação lead",
  "Data atualização lead",
  "Data período métricas lead",
  "Responsável (lead)",
  "Data compromisso (lead)",
  // Pipe WhatsApp
  "Etapa Pipe Qualificação",
  "Responsável Pipe Qualificação",
  "Data agendada (Qualificação)",
  "Notas Pipe Qualificação",
  "Data criação Pipe Qualificação",
  "Data atualização Pipe Qualificação",
  // Pipe Confirmação
  "Etapa Pipe Confirmação",
  "Responsável Pipe Confirmação",
  "Data reunião",
  "Reunião confirmada (sim/não)",
  "Notas Pipe Confirmação",
  "Data criação Pipe Confirmação",
  "Data atualização Pipe Confirmação",
  "Data período métricas Confirmação",
  // Pipe Propostas
  "Etapa Pipe Propostas",
  "Responsável Pipe Propostas",
  "Valor venda (R$)",
  "Tipo produto",
  "Calor (0-100)",
  "Data fechamento",
  "Data compromisso (proposta)",
  "Duração contrato (meses)",
  "Notas Pipe Propostas",
  "Data criação Pipe Propostas",
  "Data atualização Pipe Propostas",
  "Data período métricas Propostas",
] as const;

type ExportFormat = "csv" | "xlsx";

/**
 * Filtro por etapa do Kanban: limita a exportação aos leads que estejam na
 * etapa indicada do pipe especificado. Para pipes fixos (whatsapp/confirmacao/
 * propostas) `stageId` é o `status` enum. Para `custom`, `stageId` é o UUID
 * da stage em `custom_pipelines_stages` e `customPipelineId` é obrigatório.
 */
export interface ExportStageFilter {
  pipe: "whatsapp" | "confirmacao" | "propostas" | "custom";
  stageId: string;
  customPipelineId?: string;
}

export interface ExportLeadsOptions {
  format: ExportFormat;
  /** Limite de leads (os mais recentes). Se não informado, exporta até 10.000. */
  limit?: number;
  /** Quando presente, restringe a exportação aos leads da etapa indicada. */
  stageFilter?: ExportStageFilter;
  /** Título legível da etapa — usado apenas para compor o nome do arquivo. */
  stageTitle?: string;
}

export interface UseExportLeadsResult {
  exportLeads: (options: ExportLeadsOptions) => Promise<{ count: number }>;
  isExporting: boolean;
}

function slugify(value: string): string {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "etapa";
}

function ratingToLabel(rating: number | null | undefined): string {
  if (rating == null) return "";
  if (rating >= 9) return "Máxima";
  if (rating >= 7) return "Alta";
  if (rating >= 4) return "Média";
  if (rating >= 1) return "Baixa";
  return "";
}

function fmtDate(v: string | null | undefined): string {
  if (v == null) return "";
  try {
    return new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(v);
  }
}

export function useExportLeads(): UseExportLeadsResult {
  const [isExporting, setIsExporting] = useState(false);
  const { organizationId } = useOrganization();
  const exportPermission = useCanDo("export_leads");

  const exportLeads = async (options: ExportLeadsOptions): Promise<{ count: number }> => {
    if (!organizationId) {
      throw new Error("Organização não encontrada");
    }
    // Permission check — fail-closed during loading
    if (!exportPermission.allowed) {
      throw new Error(exportPermission.isLoading
        ? "Permissões ainda carregando — tente novamente"
        : "Você não tem permissão para exportar leads");
    }
    setIsExporting(true);
    try {
      const limit = Math.min(options.limit ?? 10_000, 50_000);

      // 0) Quando stageFilter está presente, primeiro restringimos ao
      //    conjunto de lead_ids da etapa indicada — sempre filtrando por
      //    organization_id como camada de segurança extra (RLS já protege).
      let stageLeadIds: string[] | null = null;
      if (options.stageFilter) {
        const sf = options.stageFilter;
        if (sf.pipe === "custom") {
          if (!sf.customPipelineId) {
            throw new Error("customPipelineId é obrigatório quando pipe='custom'");
          }
          const { data: entries, error: entriesError } = await supabase
            .from("custom_pipe_entries")
            .select("lead_id")
            .eq("organization_id", organizationId)
            .eq("pipeline_id", sf.customPipelineId)
            .eq("stage_id", sf.stageId);
          if (entriesError) throw entriesError;
          stageLeadIds = Array.from(new Set((entries ?? []).map((e: { lead_id: string }) => e.lead_id))).filter(Boolean);
        } else {
          // Pipes fixos — branch explícito por nome de tabela para preservar
          // tipagem do Supabase client.
          let entries: Array<{ lead_id: string }> | null = null;
          let entriesError: unknown = null;
          if (sf.pipe === "whatsapp") {
            const r = await supabase
              .from("pipe_whatsapp")
              .select("lead_id")
              .eq("organization_id", organizationId)
              .eq("status", sf.stageId);
            entries = r.data as Array<{ lead_id: string }> | null;
            entriesError = r.error;
          } else if (sf.pipe === "confirmacao") {
            const r = await supabase
              .from("pipe_confirmacao")
              .select("lead_id")
              .eq("organization_id", organizationId)
              .eq("status", sf.stageId);
            entries = r.data as Array<{ lead_id: string }> | null;
            entriesError = r.error;
          } else {
            const r = await supabase
              .from("pipe_propostas")
              .select("lead_id")
              .eq("organization_id", organizationId)
              .eq("status", sf.stageId);
            entries = r.data as Array<{ lead_id: string }> | null;
            entriesError = r.error;
          }
          if (entriesError) throw entriesError;
          stageLeadIds = Array.from(new Set((entries ?? []).map((e) => e.lead_id))).filter(Boolean);
        }

        // Etapa vazia: nada a exportar — retorna sem gerar arquivo.
        if (stageLeadIds.length === 0) {
          return { count: 0 };
        }
      }

      // 1) Leads com todos os campos
      let leadsQuery = supabase
        .from("leads")
        .select(
          "id, name, company, email, phone, faturamento, segment, urgency, notes, rating, origin, responsible_id, sdr_id, closer_id, compromisso_date, utm_campaign, utm_source, utm_medium, utm_content, utm_term, created_at, updated_at, metrics_period_at"
        )
        .eq("organization_id", organizationId);

      if (stageLeadIds) {
        leadsQuery = leadsQuery.in("id", stageLeadIds);
      }

      const { data: leads, error: leadsError } = await leadsQuery
        .order("created_at", { ascending: false })
        .limit(limit);

      if (leadsError) throw leadsError;
      const leadList = leads ?? [];
      const leadIds = leadList.map((l: { id: string }) => l.id);

      // 2) Team members para nomes
      const { data: members } = await supabase
        .from("team_members")
        .select("id, name")
        .eq("organization_id", organizationId);
      const memberByName: Record<string, string> = {};
      (members ?? []).forEach((m: { id: string; name: string }) => {
        memberByName[m.id] = m.name ?? "";
      });

      // 3) Pipe WhatsApp, Confirmação, Propostas em lotes
      const pwByLead: Record<string, Record<string, unknown>> = {};
      const pcByLead: Record<string, Record<string, unknown>> = {};
      const ppByLead: Record<string, Record<string, unknown>> = {};

      for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
        const batch = leadIds.slice(i, i + BATCH_SIZE);
        const [pwRes, pcRes, ppRes] = await Promise.all([
          supabase.from("pipe_whatsapp").select("*").eq("organization_id", organizationId).in("lead_id", batch),
          supabase.from("pipe_confirmacao").select("*").eq("organization_id", organizationId).in("lead_id", batch),
          supabase.from("pipe_propostas").select("*").eq("organization_id", organizationId).in("lead_id", batch),
        ]);
        (pwRes.data ?? []).forEach((r: Record<string, unknown>) => {
          const lid = r.lead_id as string;
          if (!pwByLead[lid] || new Date((r.updated_at as string) ?? 0) > new Date((pwByLead[lid].updated_at as string) ?? 0)) {
            pwByLead[lid] = r;
          }
        });
        (pcRes.data ?? []).forEach((r: Record<string, unknown>) => {
          const lid = r.lead_id as string;
          if (!pcByLead[lid] || new Date((r.updated_at as string) ?? 0) > new Date((pcByLead[lid].updated_at as string) ?? 0)) {
            pcByLead[lid] = r;
          }
        });
        (ppRes.data ?? []).forEach((r: Record<string, unknown>) => {
          const lid = r.lead_id as string;
          if (!ppByLead[lid] || new Date((r.updated_at as string) ?? 0) > new Date((ppByLead[lid].updated_at as string) ?? 0)) {
            ppByLead[lid] = r;
          }
        });
      }

      const rows = leadList.map((lead: Record<string, unknown>) => {
        const lid = lead.id as string;
        const pw = pwByLead[lid];
        const pc = pcByLead[lid];
        const pp = ppByLead[lid];
        return {
          "ID Lead": lid ?? "",
          Nome: lead.name ?? "",
          Empresa: lead.company ?? "",
          Email: lead.email ?? "",
          Telefone: lead.phone ?? "",
          Faturamento: lead.faturamento ?? "",
          Segmento: lead.segment ?? "",
          Urgência: lead.urgency ?? "",
          Notas: lead.notes ?? "",
          "Prioridade do lead": ratingToLabel(lead.rating as number),
          "Público de origem": lead.origin ?? "",
          utm_campaign: lead.utm_campaign ?? "",
          utm_source: lead.utm_source ?? "",
          utm_medium: lead.utm_medium ?? "",
          utm_content: lead.utm_content ?? "",
          utm_term: lead.utm_term ?? "",
          "Data criação lead": fmtDate(lead.created_at as string),
          "Data atualização lead": fmtDate(lead.updated_at as string),
          "Data período métricas lead": fmtDate(lead.metrics_period_at as string),
          "Responsável (lead)": memberByName[lead.responsible_id as string] ?? "",
          "Data compromisso (lead)": fmtDate(lead.compromisso_date as string),
          "Etapa Pipe Qualificação": pw?.status ?? "",
          "Responsável Pipe Qualificação": memberByName[(pw?.responsible_id || pw?.sdr_id) as string] ?? "",
          "Data agendada (Qualificação)": fmtDate(pw?.scheduled_date as string),
          "Notas Pipe Qualificação": pw?.notes ?? "",
          "Data criação Pipe Qualificação": fmtDate(pw?.created_at as string),
          "Data atualização Pipe Qualificação": fmtDate(pw?.updated_at as string),
          "Etapa Pipe Confirmação": pc?.status ?? "",
          "Responsável Pipe Confirmação": memberByName[(pc?.responsible_id || pc?.closer_id || pc?.sdr_id) as string] ?? "",
          "Data reunião": fmtDate(pc?.meeting_date as string),
          "Reunião confirmada (sim/não)": pc?.is_confirmed ? "sim" : (pc ? "não" : ""),
          "Notas Pipe Confirmação": pc?.notes ?? "",
          "Data criação Pipe Confirmação": fmtDate(pc?.created_at as string),
          "Data atualização Pipe Confirmação": fmtDate(pc?.updated_at as string),
          "Data período métricas Confirmação": fmtDate(pc?.metrics_period_at as string),
          "Etapa Pipe Propostas": pp?.status ?? "",
          "Responsável Pipe Propostas": memberByName[(pp?.responsible_id || pp?.closer_id) as string] ?? "",
          "Valor venda (R$)": pp?.sale_value != null ? Number(pp.sale_value) : "",
          "Tipo produto": pp?.product_type ?? "",
          "Calor (0-100)": pp?.calor != null ? Number(pp.calor) : "",
          "Data fechamento": fmtDate(pp?.closed_at as string),
          "Data compromisso (proposta)": fmtDate(pp?.commitment_date as string),
          "Duração contrato (meses)": pp?.contract_duration != null ? Number(pp.contract_duration) : "",
          "Notas Pipe Propostas": pp?.notes ?? "",
          "Data criação Pipe Propostas": fmtDate(pp?.created_at as string),
          "Data atualização Pipe Propostas": fmtDate(pp?.updated_at as string),
          "Data período métricas Propostas": fmtDate(pp?.metrics_period_at as string),
        };
      });

      const dateStamp = new Date().toISOString().slice(0, 10);
      const filename = options.stageFilter
        ? `leads_${options.stageFilter.pipe}_${slugify(options.stageTitle ?? options.stageFilter.stageId)}_${dateStamp}`
        : `leads_export_${dateStamp}`;
      const headers = [...EXPORT_LEAD_HEADERS];

      if (options.format === "csv") {
        const escape = (v: string | number) => {
          const s = String(v ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const headerLine = headers.join(",");
        const dataLines = rows.map((r) => headers.map((h) => escape((r as Record<string, string | number>)[h] ?? "")).join(","));
        const csv = [headerLine, ...dataLines].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet("Leads");
        ws.addRow(headers);
        for (const row of rows) {
          ws.addRow(headers.map((h) => (row as Record<string, string | number>)[h] ?? ""));
        }
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      }

      return { count: rows.length };
    } finally {
      setIsExporting(false);
    }
  };

  return { exportLeads, isExporting };
}
