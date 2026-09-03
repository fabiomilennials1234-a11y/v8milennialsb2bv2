import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
import { applyLeadListFilters, type LeadListFilterValues } from "../lib/lead-list-filters";
import {
  buildExportHeaders,
  buildFunnelCells,
  isStageUuid,
  orderPipelinesForExport,
  pickLatestEntryPerFunnel,
  type ExportPipeline,
  type ExportPipelineEntry,
  type ExportPipelineStage,
} from "../lib/export-columns";
const BATCH_SIZE = 500;

/**
 * Bloco FIXO do lead no arquivo exportado.
 *
 * SCRUM-635: este const era "lead + os 3 pipes de sistema" (a união de tipo dos
 * 3 cabeçalhos fixos). Os blocos por pipe morreram — agora as colunas de funil
 * são DINÂMICAS, derivadas dos funis reais da org (`pipelines` +
 * `pipeline_stages`), um bloco por funil com o nome dele (ver
 * `../lib/export-columns.ts`). Aqui fica só o que é do lead.
 */
export const EXPORT_LEAD_HEADERS = [
  "ID Lead",
  "Nome",
  "Empresa",
  "Email",
  "Telefone",
  "Faturamento",
  "Segmento",
  "Urgência",
  "Notas",
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
] as const;

type ExportFormat = "csv" | "xlsx";

/**
 * Filtro por etapa do Kanban: limita a exportação aos leads que estejam na
 * etapa indicada do funil especificado.
 *
 * SCRUM-635/637: o MOTOR é único — (pipeline_id, etapa) resolve direto em
 * `pipeline_entries` (fonte única pós-W3). Os braços legados por slug
 * ("whatsapp"/"confirmacao"/"propostas") e "custom" morreram no flip da 637
 * junto com as páginas que os alimentavam — este é o único formato.
 */
export interface ExportStageFilter {
  /** `pipelines.id` — endereça QUALQUER funil (sistema ou custom). */
  pipelineId: string;
  /** uuid de `pipeline_stages` (canônico) ou stage_key. */
  stageId: string;
}

/** Filtros ativos da lista de leads (busca, origem, qualificação, UF).
 * Mesma semântica de `applyLeadListFilters` — reaproveita a fonte única. */
export type ExportListFilters = LeadListFilterValues;

export interface ExportLeadsOptions {
  format: ExportFormat;
  /** Limite de leads (os mais recentes). Se não informado, exporta até 10.000. */
  limit?: number;
  /** Quando presente, restringe a exportação aos leads da etapa indicada. */
  stageFilter?: ExportStageFilter;
  /** Título legível da etapa — usado apenas para compor o nome do arquivo. */
  stageTitle?: string;
  /** Filtros ativos da lista — aplicados à exportação para espelhar o que o
   * usuário vê na tela (busca, origem, qualificação, UF). */
  listFilters?: ExportListFilters;
  /**
   * Restringe a exportação a um conjunto EXPLÍCITO de leads — a seleção
   * manual do bulk (SCRUM-633). Compõe por interseção com stageFilter e
   * listFilters quando presentes. Lista vazia exporta nada.
   */
  leadIds?: string[];
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

function fmtDate(v: string | null | undefined): string {
  if (v == null || v === "") return "";
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

      // 0) Funis reais da org — servem tanto à resolução do stageFilter quanto
      //    aos cabeçalhos dinâmicos do arquivo (SCRUM-635).
      const { data: pipelinesData, error: pipelinesError } = await supabase
        .from("pipelines")
        .select("id, name, slug, type")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (pipelinesError) throw pipelinesError;
      const pipelines = orderPipelinesForExport((pipelinesData ?? []) as ExportPipeline[]);
      const pipelineIds = pipelines.map((p) => p.id);

      // Etapas dos funis — sem filtro de is_active de propósito: entry parada
      // em etapa desativada ainda precisa sair com o NOME da etapa, não o cru.
      // `as any` no from: pipeline_stages.pipeline_id (20270906001000) ainda
      // não está no types.ts gerado — mesmo padrão de usePipelines.
      let stages: ExportPipelineStage[] = [];
      if (pipelineIds.length > 0) {
        const { data: stagesData, error: stagesError } = await (supabase.from as any)(
          "pipeline_stages",
        )
          .select("id, pipeline_id, stage_key, name")
          .eq("organization_id", organizationId)
          .in("pipeline_id", pipelineIds);
        if (stagesError) throw stagesError;
        stages = (stagesData ?? []) as ExportPipelineStage[];
      }
      const stagesById = new Map(stages.map((s) => [s.id, s]));
      const stagesByPipelineAndKey = new Map(
        stages.filter((s) => s.pipeline_id && s.stage_key).map((s) => [`${s.pipeline_id}:${s.stage_key}`, s]),
      );

      // 0.25) stageFilter — MOTOR ÚNICO (SCRUM-635): todo modo colapsa em
      //       (pipeline_id, etapa) e resolve direto em `pipeline_entries`.
      let stageLeadIds: string[] | null = null;
      if (options.stageFilter) {
        const sf = options.stageFilter;
        if (!sf.pipelineId) {
          throw new Error("pipelineId é obrigatório no stageFilter");
        }
        const targetPipelineId = sf.pipelineId;

        // `as any` no from: pipeline_entries.stage_id (20270906002000) ainda
        // não está no types.ts gerado — mesmo padrão de usePipelines.
        let entriesQuery = (supabase.from as any)("pipeline_entries")
          .select("lead_id")
          .eq("organization_id", organizationId)
          .eq("pipeline_id", targetPipelineId);
        // Etapa por uuid (canônico) ou stage_key (formato legado dos 3 pipes).
        entriesQuery = isStageUuid(sf.stageId)
          ? entriesQuery.eq("stage_id", sf.stageId)
          : entriesQuery.eq("stage_key", sf.stageId);
        const { data: entries, error: entriesError } = await entriesQuery;
        if (entriesError) throw entriesError;
        stageLeadIds = Array.from(
          new Set(((entries ?? []) as Array<{ lead_id: string | null }>).map((e) => e.lead_id)),
        ).filter(Boolean) as string[];

        // Etapa vazia: nada a exportar — retorna sem gerar arquivo.
        if (stageLeadIds.length === 0) {
          return { count: 0 };
        }
      }

      // 0.5) Seleção manual (bulk, SCRUM-633): interseção explícita com o que
      // o stageFilter resolveu (ou o recorte inteiro quando não há stageFilter).
      if (options.leadIds) {
        const sel = new Set(options.leadIds);
        stageLeadIds = stageLeadIds
          ? stageLeadIds.filter((id) => sel.has(id))
          : Array.from(sel);
        if (stageLeadIds.length === 0) {
          return { count: 0 };
        }
      }

      // 1) Leads com todos os campos
      let leadsQuery = supabase
        .from("leads")
        .select(
          "id, name, company, email, phone, faturamento, segment, urgency, notes, origin, responsible_id, sdr_id, closer_id, compromisso_date, utm_campaign, utm_source, utm_medium, utm_content, utm_term, created_at, updated_at, metrics_period_at"
        )
        .eq("organization_id", organizationId);

      if (stageLeadIds) {
        leadsQuery = leadsQuery.in("id", stageLeadIds);
      }

      // Espelha os filtros ativos da lista (busca, origem, qualificação,
      // UF) — mesma semântica da tela via helper compartilhado.
      if (options.listFilters) {
        leadsQuery = applyLeadListFilters(leadsQuery, options.listFilters);
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
      const memberName = (id: string | null | undefined) => (id ? memberByName[id] ?? "" : "");

      // 3) Entries de TODOS os funis da org, em lotes de leads — uma query por
      //    lote no lugar das 3 fixas por pipe (SCRUM-635). O desempate por
      //    (funil, lead) segue o legado: updated_at mais recente vence.
      const allEntries: ExportPipelineEntry[] = [];
      if (pipelineIds.length > 0) {
        for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
          const batch = leadIds.slice(i, i + BATCH_SIZE);
          // `as any`: pipeline_entries.stage_id fora do types.ts (ver acima).
          const { data: batchEntries, error: batchError } = await (supabase.from as any)(
            "pipeline_entries",
          )
            .select(
              "pipeline_id, lead_id, stage_id, stage_key, assigned_to, notes, closed_at, created_at, updated_at, metadata",
            )
            .eq("organization_id", organizationId)
            .in("lead_id", batch);
          if (batchError) throw batchError;
          allEntries.push(...((batchEntries ?? []) as ExportPipelineEntry[]));
        }
      }
      const entryByFunnelAndLead = pickLatestEntryPerFunnel(allEntries);

      const cellCtx = { stagesById, stagesByPipelineAndKey, memberName, fmtDate };

      const rows = leadList.map((lead: Record<string, unknown>) => {
        const lid = lead.id as string;
        const row: Record<string, string | number> = {
          "ID Lead": lid ?? "",
          Nome: (lead.name as string) ?? "",
          Empresa: (lead.company as string) ?? "",
          Email: (lead.email as string) ?? "",
          Telefone: (lead.phone as string) ?? "",
          Faturamento: (lead.faturamento as string) ?? "",
          Segmento: (lead.segment as string) ?? "",
          Urgência: (lead.urgency as string) ?? "",
          Notas: (lead.notes as string) ?? "",
          "Público de origem": (lead.origin as string) ?? "",
          utm_campaign: (lead.utm_campaign as string) ?? "",
          utm_source: (lead.utm_source as string) ?? "",
          utm_medium: (lead.utm_medium as string) ?? "",
          utm_content: (lead.utm_content as string) ?? "",
          utm_term: (lead.utm_term as string) ?? "",
          "Data criação lead": fmtDate(lead.created_at as string),
          "Data atualização lead": fmtDate(lead.updated_at as string),
          "Data período métricas lead": fmtDate(lead.metrics_period_at as string),
          "Responsável (lead)": memberName(lead.responsible_id as string),
          "Data compromisso (lead)": fmtDate(lead.compromisso_date as string),
        };
        for (const pipeline of pipelines) {
          const entry = entryByFunnelAndLead.get(`${pipeline.id}:${lid}`);
          Object.assign(row, buildFunnelCells(pipeline.name ?? "", entry, cellCtx));
        }
        return row;
      });

      const dateStamp = new Date().toISOString().slice(0, 10);
      const filename = options.stageFilter
        ? `leads_funil_${slugify(options.stageTitle ?? options.stageFilter.stageId)}_${dateStamp}`
        : `leads_export_${dateStamp}`;
      const headers = buildExportHeaders(EXPORT_LEAD_HEADERS, pipelines);

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
