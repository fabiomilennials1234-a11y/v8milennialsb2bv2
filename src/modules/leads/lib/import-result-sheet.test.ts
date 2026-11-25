import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildResultWorkbook, resultLines } from "./import-result-sheet";
import type { ImportPreview } from "./import-preview";

const ORIGIN = "https://app.torque.test";

const PREVIEW: ImportPreview = {
  rows: [
    { row: 2, group: "novo", name: "Le Bari Café" },
    {
      row: 15,
      group: "cliente_erp",
      name: "Santo Bistrô",
      match: { origem: "crm", lead_id: "erp-1", label: "SANTO CAFFE", erp_code: "10088", visible: true },
    },
    {
      row: 17,
      group: "outra_empresa",
      name: "Leña Torrefação",
      match: { origem: "arquivo", row: 16, label: "Café Colonial Bela Vista", visible: true },
    },
    { row: 41, group: "repetido", name: "Empório Canela Restaurante", match: { origem: "arquivo", row: 9, label: "Empório Canela Restaurante", visible: true } },
  ],
  counts: { novo: 1, cliente_erp: 1, ja_lead: 0, repetido: 1, outra_empresa: 1, sem_telefone: 0, invalido: 0 },
};

const REPORT = {
  rows: [
    { row: 2, outcome: "criado" as const, lead_id: "l-2" },
    { row: 15, outcome: "pulado" as const },
    { row: 17, outcome: "compartilhado" as const, lead_id: "l-17" },
    { row: 41, outcome: "pulado" as const },
  ],
  errors: [{ row: 30, reason: "Linha 30: telefone inválido (123)" }],
};

describe("resultLines", () => {
  it("diz o resultado e o motivo na língua da planilha", () => {
    const lines = resultLines(REPORT, PREVIEW, ORIGIN);
    expect(lines.get(2)).toEqual({ resultado: "Importado", motivo: "", link: `${ORIGIN}/leads?lead=l-2`, tone: "ok" });
    expect(lines.get(15)).toMatchObject({
      resultado: "Pulado na revisão",
      motivo: "Cliente do ERP cód 10088 — SANTO CAFFE",
      link: null,
    });
    expect(lines.get(17)).toMatchObject({
      resultado: "Importado — telefone compartilhado",
      motivo: "Mesmo número de Café Colonial Bela Vista (linha 16)",
      link: `${ORIGIN}/leads?lead=l-17`,
    });
    expect(lines.get(41)?.motivo).toBe("Mesmo número de Empório Canela Restaurante (linha 9)");
    // Recusada na validação: não está em `rows`, vem dos erros.
    expect(lines.get(30)).toMatchObject({ resultado: "Não importado", motivo: "Linha 30: telefone inválido (123)" });
  });
});

describe("buildResultWorkbook", () => {
  it("XLSX: as colunas entram depois da última do cabeçalho, na linha certa", async () => {
    const original = new ExcelJS.Workbook();
    const ws = original.addWorksheet("Leads");
    ws.addRow(["Empresa", "Telefone", "Segmento"]);
    ws.addRow(["Le Bari Café", "(54) 99931-6404", "Cafeteria"]);
    for (let i = 3; i <= 14; i++) ws.addRow([`Empresa ${i}`, "", ""]);
    ws.addRow(["Santo Bistrô", "(54) 98144-8969", "Cafeteria"]);
    original.addWorksheet("Instruções").addRow(["não mexer"]);
    const buffer = (await original.xlsx.writeBuffer()) as ArrayBuffer;

    const out = await buildResultWorkbook(ExcelJS, { kind: "xlsx", buffer }, resultLines(REPORT, PREVIEW, ORIGIN));
    const sheet = out.worksheets[0];
    expect(sheet.getRow(1).getCell(4).value).toBe("Resultado");
    expect(sheet.getRow(1).getCell(5).value).toBe("Motivo");
    expect(sheet.getRow(2).getCell(4).value).toBe("Importado");
    expect(sheet.getRow(2).getCell(6).value).toEqual({ text: "Abrir lead", hyperlink: `${ORIGIN}/leads?lead=l-2` });
    expect(sheet.getRow(15).getCell(1).value).toBe("Santo Bistrô");
    expect(sheet.getRow(15).getCell(4).value).toBe("Pulado na revisão");
    expect(out.worksheets[1].getRow(1).getCell(1).value).toBe("não mexer");
  });

  it("CSV: cada linha volta para a linha em que estava, mesmo com linha vazia no meio", async () => {
    const rows = [
      { Empresa: "Le Bari Café", Telefone: "54999316404" },
      { Empresa: "Santo Bistrô", Telefone: "54981448969" },
    ];
    const out = await buildResultWorkbook(
      ExcelJS,
      { kind: "csv", rows, sourceRows: [2, 15] },
      resultLines(REPORT, PREVIEW, ORIGIN),
    );
    const sheet = out.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, "Empresa", "Telefone", "Resultado", "Motivo", "Link"]);
    expect(sheet.getRow(15).getCell(1).value).toBe("Santo Bistrô");
    expect(sheet.getRow(15).getCell(3).value).toBe("Pulado na revisão");
    expect(sheet.getRow(3).getCell(1).value).toBeNull();
  });
});
