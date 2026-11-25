/**
 * Planilha de resultado da importação: a planilha que a pessoa enviou, com três
 * colunas a mais — Resultado, Motivo e Link — na linha de cada lead.
 *
 * Em 25/11/2026 a usuária da Café Jurerê montou isso à mão para conferir as recusas;
 * o botão "Baixar resultado" entrega pronto. Só com a prévia (flag `importacao_previa`),
 * que é quando a edge devolve o resultado de cada linha.
 */
import type { Workbook, Worksheet } from "exceljs";
import { GROUP_META, matchSentence, type ImportPreview } from "./import-preview";
import { isBlankRow } from "./import-source-row";

export interface ImportRowOutcomeLike {
  row: number;
  outcome: "criado" | "compartilhado" | "atualizado" | "vinculado" | "pulado" | "recusado";
  reason?: string;
  lead_id?: string;
}

export interface ResultReportLike {
  rows?: ImportRowOutcomeLike[];
  errors: { row: number; reason: string }[];
}

export type ResultTone = "ok" | "info" | "skip" | "bad";

export interface ResultLine {
  resultado: string;
  motivo: string;
  link: string | null;
  tone: ResultTone;
}

const FILL: Record<ResultTone, string> = {
  ok: "FFE2EFDA",
  info: "FFDDEBF7",
  skip: "FFEDEDED",
  bad: "FFFCE4D6",
};

/** Resultado e motivo de cada linha da planilha, pelo número da linha do Excel. */
export function resultLines(
  report: ResultReportLike,
  preview: ImportPreview | null,
  origin: string,
): Map<number, ResultLine> {
  const previewByRow = new Map((preview?.rows ?? []).map((r) => [r.row, r]));
  const lines = new Map<number, ResultLine>();
  const link = (id?: string) => (id ? `${origin}/leads?lead=${id}` : null);

  for (const o of report.rows ?? []) {
    const p = previewByRow.get(o.row);
    const contexto = p ? matchSentence(p) : null;
    switch (o.outcome) {
      case "criado":
        lines.set(o.row, { resultado: "Importado", motivo: o.reason ?? "", link: link(o.lead_id), tone: "ok" });
        break;
      case "compartilhado":
        lines.set(o.row, {
          resultado: "Importado — telefone compartilhado",
          motivo: o.reason ?? contexto ?? "",
          link: link(o.lead_id),
          tone: "ok",
        });
        break;
      case "atualizado":
        lines.set(o.row, {
          resultado: "Já era lead — campos vazios completados",
          motivo: contexto ?? "",
          link: link(o.lead_id),
          tone: "info",
        });
        break;
      case "vinculado":
        lines.set(o.row, {
          resultado: p?.group === "cliente_erp" ? "Já é cliente do ERP — etiquetas aplicadas" : "Já era lead — nada a completar",
          motivo: contexto ?? "",
          link: link(o.lead_id),
          tone: "info",
        });
        break;
      case "pulado":
        lines.set(o.row, {
          resultado: "Pulado na revisão",
          motivo: contexto ?? (p ? GROUP_META[p.group].title : ""),
          link: null,
          tone: "skip",
        });
        break;
      default:
        lines.set(o.row, { resultado: "Não importado", motivo: o.reason ?? "", link: null, tone: "bad" });
    }
  }

  // Linhas recusadas antes do motor (validação) não estão em `rows`.
  for (const e of report.errors) {
    if (e.row > 0 && !lines.has(e.row)) {
      lines.set(e.row, { resultado: "Não importado", motivo: e.reason, link: null, tone: "bad" });
    }
  }
  return lines;
}

/** Escreve Resultado, Motivo e Link depois da última coluna usada no cabeçalho. */
export function writeResultColumns(sheet: Worksheet, lines: Map<number, ResultLine>): void {
  const header = sheet.getRow(1);
  const base = Math.max(header.actualCellCount, header.cellCount);
  const titles = ["Resultado", "Motivo", "Link"];
  titles.forEach((t, i) => {
    const cell = header.getCell(base + 1 + i);
    cell.value = t;
    cell.font = { bold: true };
  });
  sheet.getColumn(base + 1).width = 34;
  sheet.getColumn(base + 2).width = 70;
  sheet.getColumn(base + 3).width = 30;

  for (const [rowNumber, line] of lines) {
    const row = sheet.getRow(rowNumber);
    row.getCell(base + 1).value = line.resultado;
    row.getCell(base + 2).value = line.motivo;
    row.getCell(base + 2).alignment = { wrapText: true, vertical: "top" };
    if (line.link) row.getCell(base + 3).value = { text: "Abrir lead", hyperlink: line.link };
    for (let c = 1; c <= base + 3; c++) {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[line.tone] } };
    }
  }
}

/**
 * Planilha de resultado a partir do arquivo enviado. XLSX: a mesma pasta, com as
 * colunas na primeira aba (a que o import lê). CSV: uma aba nova com as mesmas linhas,
 * cada uma na linha em que estava no arquivo.
 */
export async function buildResultWorkbook(
  ExcelJS: typeof import("exceljs"),
  source: { kind: "xlsx"; buffer: ArrayBuffer } | { kind: "csv"; rows: Record<string, string>[]; sourceRows: (number | undefined)[] },
  lines: Map<number, ResultLine>,
): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (source.kind === "xlsx") {
    await workbook.xlsx.load(source.buffer);
    const sheet = workbook.worksheets[0];
    if (sheet) writeResultColumns(sheet, lines);
    return workbook;
  }

  const sheet = workbook.addWorksheet("Leads");
  const headers = [...new Set(source.rows.flatMap((r) => Object.keys(r)))];
  sheet.getRow(1).values = headers;
  source.rows.forEach((r, i) => {
    if (isBlankRow(r)) return;
    sheet.getRow(source.sourceRows[i] ?? i + 2).values = headers.map((h) => r[h] ?? "");
  });
  writeResultColumns(sheet, lines);
  return workbook;
}

/** Baixa o arquivo pelo navegador. */
export async function downloadResultWorkbook(workbook: Workbook, fileName: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/\.(xlsx|xls|csv)$/i, "")} - resultado.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
