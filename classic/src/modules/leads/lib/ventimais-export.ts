import type { Tables } from "@/integrations/supabase/types";
import type { Workbook } from "exceljs";
import { buildFunnelCells, type ExportPipelineStage } from "./export-columns";

export const VENTIMAIS_ORGANIZATION_ID = "56b88e32-be6a-436e-b4e6-6e1293d21659";
export const VENTIMAIS_EXPORT_FLAG = "kanban_export_details";

/** Rollout exclusivo: a flag sozinha nunca libera outra organização. */
export function isVentimaisExportEnabled(organizationId: string | null | undefined, flag: unknown): boolean {
  return organizationId === VENTIMAIS_ORGANIZATION_ID && flag === true;
}

export type ExportEntry = Tables<"pipeline_entries">;
export type ExportComment = Pick<Tables<"lead_comments">,
  "id" | "organization_id" | "lead_id" | "pipeline_entry_id" | "body" | "created_at" | "updated_at" | "deleted_at" | "author_team_member_id">;
export type ExportLead = Pick<Tables<"leads">,
  "id" | "name" | "company" | "email" | "phone" | "faturamento" | "segment" | "urgency" | "notes" | "origin" |
  "utm_campaign" | "utm_source" | "utm_medium" | "utm_content" | "utm_term" | "created_at" | "updated_at" |
  "metrics_period_at" | "responsible_id" | "compromisso_date">;
export type ExportDeal = Pick<Tables<"deals">,
  "id" | "title" | "value" | "currency" | "probability" | "expected_close_date" | "outcome" | "loss_reason" | "notes">;
export interface VentimaisExportData {
  pipeline: { id: string; name: string | null };
  entries: ExportEntry[];
  leads: ExportLead[];
  deals: ExportDeal[];
  stages: (ExportPipelineStage & { stage_role?: string | null })[];
  members: { id: string; name: string | null }[];
  comments: ExportComment[];
  fields: { id: string; field_name: string }[];
  fieldValues: { lead_id: string; field_id: string; value: string | null }[];
}

const CELL_LIMIT = 32_767;
const COMMENT_PREVIEW_LIMIT = 30_000;
function date(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Excel limita células a 32.767 caracteres; continua o texto sem perder dados. */
export function splitExcelText(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + CELL_LIMIT, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [""];
}

/** Uma linha por entrada do kanban; comentários de outros negócios não são anexados. */
export function buildVentimaisWorkbook(workbook: Workbook, data: VentimaisExportData): void {
  const leads = new Map(data.leads.map(l => [l.id, l]));
  const deals = new Map(data.deals.map(d => [d.id, d]));
  const members = new Map(data.members.map(m => [m.id, m.name]));
  const values = new Map(data.fieldValues.map(v => [`${v.lead_id}:${v.field_id}`, v.value]));
  const entries = data.entries.filter(e => e.organization_id === VENTIMAIS_ORGANIZATION_ID && e.pipeline_id === data.pipeline.id && e.lead_id && leads.has(e.lead_id));
  const entryById = new Map(entries.map(e => [e.id, e]));
  const leadIds = new Set(entries.map(e => e.lead_id));
  const comments = data.comments.filter(c =>
    c.organization_id === VENTIMAIS_ORGANIZATION_ID && !c.deleted_at && leadIds.has(c.lead_id) &&
    (c.pipeline_entry_id === null || entryById.get(c.pipeline_entry_id)?.lead_id === c.lead_id),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const commentsByEntry = new Map<string, ExportComment[]>();
  const commentsByLead = new Map<string, ExportComment[]>();
  for (const comment of comments) {
    const map = comment.pipeline_entry_id ? commentsByEntry : commentsByLead;
    const key = comment.pipeline_entry_id ?? comment.lead_id;
    const list = map.get(key) ?? [];
    list.push(comment);
    map.set(key, list);
  }
  const author = (c: ExportComment) => members.get(c.author_team_member_id ?? "") ?? "Usuário";
  const summary = (list: ExportComment[]) => {
    const text = list.map(c => `[${date(c.created_at)}] ${author(c)}: ${c.body}`).join("\n\n");
    return text.length > COMMENT_PREVIEW_LIMIT
      ? `${text.slice(0, COMMENT_PREVIEW_LIMIT)}\n[Histórico completo na aba Comentários]`
      : text;
  };
  const stageCtx = {
    stagesById: new Map(data.stages.map(s => [s.id, s])),
    stagesByPipelineAndKey: new Map(data.stages.map(s => [`${s.pipeline_id}:${s.stage_key}`, s])),
    memberName: (id: string | null | undefined) => members.get(id ?? "") ?? "",
    fmtDate: date,
  };
  const fieldNames = new Map<string, number>();
  const fieldHeaders = data.fields.map(field => {
    const occurrence = (fieldNames.get(field.field_name) ?? 0) + 1;
    fieldNames.set(field.field_name, occurrence);
    return { id: field.id, header: `Campo: ${field.field_name}${occurrence > 1 ? ` (${occurrence})` : ""}` };
  });
  const rows = entries.map(entry => {
    const lead = leads.get(entry.lead_id!)!;
    const deal = deals.get(entry.deal_id ?? "");
    const metadata = entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {};
    const stage = data.stages.find(s => s.id === entry.stage_id)
      ?? data.stages.find(s => s.pipeline_id === entry.pipeline_id && s.stage_key === entry.stage_key);
    const outcome = deal?.outcome ?? (stage?.stage_role === "won" ? "won" : stage?.stage_role === "lost" ? "lost" : "open");
    const row: Record<string, string | number> = {
      "ID Negócio (card)": entry.id, "ID Deal": entry.deal_id ?? "", "Negócio": deal?.title ?? data.pipeline.name ?? "Funil",
      "ID Lead": lead.id, "Nome": lead.name ?? "", "Empresa": lead.company ?? "", "Email": lead.email ?? "", "Telefone": lead.phone ?? "",
      "Faturamento": lead.faturamento ?? "", "Segmento": lead.segment ?? "", "Urgência": lead.urgency ?? "", "Notas do lead": lead.notes ?? "",
      "Público de origem": lead.origin ?? "", "utm_campaign": lead.utm_campaign ?? "", "utm_source": lead.utm_source ?? "", "utm_medium": lead.utm_medium ?? "",
      "utm_content": lead.utm_content ?? "", "utm_term": lead.utm_term ?? "", "Data criação lead": date(lead.created_at), "Data atualização lead": date(lead.updated_at),
      "Data período métricas lead": date(lead.metrics_period_at), "Responsável (lead)": stageCtx.memberName(lead.responsible_id), "Data compromisso (lead)": date(lead.compromisso_date),
      ...buildFunnelCells(data.pipeline.name ?? "Funil", { ...entry, metadata }, stageCtx),
      "Valor do negócio": deal?.value ?? "", "Moeda": deal?.currency ?? "", "Probabilidade (%)": deal?.probability ?? "",
      "Previsão de fechamento": deal?.expected_close_date ?? "", "Desfecho": outcome === "won" ? "Ganho" : outcome === "lost" ? "Perdido" : "Aberto",
      "Motivo da perda": deal?.loss_reason ?? "", "Notas do cadastro do negócio": deal?.notes ?? "",
      "Comentários do negócio": summary(commentsByEntry.get(entry.id) ?? []),
      "Comentários gerais do lead": summary(commentsByLead.get(lead.id) ?? []),
    };
    for (const field of fieldHeaders) row[field.header] = values.get(`${lead.id}:${field.id}`) ?? "";
    return row;
  });

  // Campos livres também podem exceder o limite: colunas de continuação.
  const expandedRows = rows.map(row => {
    const expanded: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number") expanded[key] = value;
      else splitExcelText(value).forEach((part, i) => { expanded[i === 0 ? key : `${key} (continuação ${i + 1})`] = part; });
    }
    return expanded;
  });
  const headers = [...new Set(expandedRows.flatMap(row => Object.keys(row)))];
  const sheet = workbook.addWorksheet("Negócios");
  sheet.addRow(headers);
  for (const row of expandedRows) sheet.addRow(headers.map(header => row[header] ?? ""));

  const history = workbook.addWorksheet("Comentários");
  history.addRow(["ID Comentário", "ID Negócio (card)", "ID Lead", "Origem", "Autor", "Data", "Editado em", "Parte", "Comentário"]);
  for (const c of comments) {
    splitExcelText(c.body).forEach((part, i) => history.addRow([
      c.id, c.pipeline_entry_id ?? "", c.lead_id, c.pipeline_entry_id ? "Negócio" : "Geral do lead",
      author(c), date(c.created_at), date(c.updated_at), i + 1, part,
    ]));
  }
  for (const ws of [sheet, history]) {
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach(column => { column.width = 26; column.alignment = { vertical: "top", wrapText: true }; });
  }
  history.getColumn(9).width = 85;
}
