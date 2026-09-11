import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildVentimaisWorkbook, isVentimaisExportEnabled, splitExcelText, VENTIMAIS_ORGANIZATION_ID as ORG, type ExportEntry, type ExportLead, type ExportComment, type VentimaisExportData } from "@/modules/leads/lib/ventimais-export";

export function entry(id: string, overrides: Partial<ExportEntry> = {}): ExportEntry {
  return { id, organization_id: ORG, pipeline_id: "pipeline-1", lead_id: "lead-1", deal_id: null, assigned_to: null, closed_at: null,
    created_at: "2026-09-10T12:00:00Z", updated_at: "2026-09-10T12:00:00Z", entered_at: null, stage_changed_at: null,
    stage_id: "stage-1", stage_key: "novo", metadata: {}, notes: `Nota ${id}`, ...overrides };
}
export function lead(id = "lead-1"): ExportLead {
  return { id, name: "Cliente", company: "Empresa", email: null, phone: null, faturamento: null, segment: null, urgency: null, notes: "Informação do lead",
    origin: null, utm_campaign: null, utm_source: null, utm_medium: null, utm_content: null, utm_term: null,
    created_at: "2026-09-10T12:00:00Z", updated_at: null, metrics_period_at: null, responsible_id: null, compromisso_date: null };
}
function comment(id: string, entryId: string | null, body: string, overrides: Partial<ExportComment> = {}): ExportComment {
  return { id, organization_id: ORG, lead_id: "lead-1", pipeline_entry_id: entryId, body, created_at: "2026-09-10T12:00:00Z", updated_at: null,
    deleted_at: null, author_team_member_id: "member-1", ...overrides };
}
function fixture(): VentimaisExportData {
  return { pipeline: { id: "pipeline-1", name: "Qualificação" }, entries: [entry("entry-1"), entry("entry-2")], leads: [lead()], deals: [],
    stages: [{ id: "stage-1", pipeline_id: "pipeline-1", stage_key: "novo", name: "Novo" }], members: [{ id: "member-1", name: "Ana" }],
    comments: [], fields: [{ id: "field-1", field_name: "Informações" }], fieldValues: [{ lead_id: "lead-1", field_id: "field-1", value: "Precisa de instalação" }] };
}
function cell(sheet: ExcelJS.Worksheet, row: number, name: string) {
  const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
  return sheet.getRow(row).getCell(headers.indexOf(name)).value;
}

describe("Excel exclusivo da Ventimais", () => {
  it("exige o UUID da Ventimais e boolean true", () => {
    expect(isVentimaisExportEnabled(ORG, true)).toBe(true);
    for (const flag of [false, undefined, null, "true", 1, {}]) expect(isVentimaisExportEnabled(ORG, flag)).toBe(false);
    expect(isVentimaisExportEnabled("outra-org", true)).toBe(false);
    expect(isVentimaisExportEnabled(null, true)).toBe(false);
  });

  it("mantém dois negócios do mesmo lead e separa histórico geral, autor e vínculo", async () => {
    const data = fixture();
    data.comments = [comment("c2", "entry-2", "Segundo negócio"), comment("c1", "entry-1", "Primeiro negócio"), comment("geral", null, "Observação geral"),
      comment("outro", "entry-outro", "NÃO EXPORTAR"), comment("apagado", "entry-1", "NÃO EXPORTAR", { deleted_at: "2026-09-10" }),
      comment("org", "entry-1", "NÃO EXPORTAR", { organization_id: "outra-org" }), comment("lead", "entry-1", "NÃO EXPORTAR", { lead_id: "outro-lead" })];
    data.entries.push(entry("outro-funil", { pipeline_id: "outro" }), entry("outra-org", { organization_id: "outra" }));
    const workbook = new ExcelJS.Workbook();
    buildVentimaisWorkbook(workbook, data);
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.getWorksheet("Negócios")!;
    expect(sheet.rowCount).toBe(3);
    expect(cell(sheet, 2, "ID Negócio (card)")).toBe("entry-1");
    expect(cell(sheet, 3, "ID Negócio (card)")).toBe("entry-2");
    expect(cell(sheet, 2, "Comentários do negócio")).toContain("Ana: Primeiro negócio");
    expect(cell(sheet, 2, "Comentários do negócio")).not.toContain("Segundo negócio");
    expect(cell(sheet, 3, "Comentários do negócio")).toContain("Segundo negócio");
    expect(cell(sheet, 2, "Comentários gerais do lead")).toContain("Observação geral");
    expect(cell(sheet, 2, "Notas — Qualificação")).toBe("Nota entry-1");
    expect(cell(sheet, 2, "Campo: Informações")).toBe("Precisa de instalação");
    expect(restored.getWorksheet("Comentários")!.rowCount).toBe(4);
    expect(JSON.stringify(restored.model)).not.toContain("NÃO EXPORTAR");
  });

  it("preserva textos acima do limite do Excel e trata fórmulas como texto", async () => {
    const data = fixture();
    const long = "a".repeat(32766) + "😀" + "b".repeat(40000);
    data.comments = [comment("long", "entry-1", long), comment("formula", "entry-2", '=HYPERLINK("https://example.com")')];
    data.entries[0].notes = long;
    data.leads[0].name = "=1+1";
    const workbook = new ExcelJS.Workbook();
    buildVentimaisWorkbook(workbook, data);
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const history = restored.getWorksheet("Comentários")!;
    const parts: string[] = [];
    history.eachRow((row, n) => { if (n > 1 && row.getCell(1).value === "long") parts.push(String(row.getCell(9).value)); });
    expect(parts.join("")).toBe(long);
    expect(parts.every(p => p.length <= 32767)).toBe(true);
    expect(splitExcelText(long).join("")).toBe(long);
    const sheet = restored.getWorksheet("Negócios")!;
    expect(cell(sheet, 2, "Nome")).toBe("=1+1");
    expect(cell(sheet, 2, "Comentários do negócio")).toContain("Histórico completo na aba Comentários");
    expect(String(cell(sheet, 2, "Notas — Qualificação")) + String(cell(sheet, 2, "Notas — Qualificação (continuação 2)")) + String(cell(sheet, 2, "Notas — Qualificação (continuação 3)"))).toBe(long);
  });

  it("negócio legado sem deal usa o desfecho da etapa canônica", () => {
    const data = fixture();
    data.stages[0].stage_role = "won";
    const workbook = new ExcelJS.Workbook();
    buildVentimaisWorkbook(workbook, data);
    expect(cell(workbook.getWorksheet("Negócios")!, 2, "Desfecho")).toBe("Ganho");
  });
});
