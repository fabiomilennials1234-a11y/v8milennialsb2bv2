/**
 * Lê o arquivo que o usuário escolheu (CSV ou XLSX) em cabeçalhos + linhas de
 * células cruas. Nada sai do navegador aqui: o que vai ao banco é montado por
 * `planilha.ts` e julgado pela RPC `cobranca_importar` (dry-run primeiro).
 *
 * exceljs é carregado sob demanda — é pesado e só esta tela o usa.
 */
import Papa from "papaparse";

export interface PlanilhaLida {
  cabecalhos: string[];
  linhas: unknown[][];
}

export const LIMITE_DE_LINHAS = 2000;

function valorDaCelula(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if ("result" in o) return valorDaCelula(o.result); // fórmula
  if ("richText" in o && Array.isArray(o.richText)) {
    return (o.richText as { text?: string }[]).map((p) => p.text ?? "").join("");
  }
  if ("text" in o) return o.text; // hyperlink
  return null;
}

async function lerCsv(arquivo: File): Promise<PlanilhaLida> {
  const textoBruto = await arquivo.text();
  const resultado = Papa.parse<string[]>(textoBruto, { skipEmptyLines: "greedy" });
  const [cabecalhos = [], ...linhas] = resultado.data;
  return { cabecalhos: cabecalhos.map((c) => String(c ?? "")), linhas };
}

async function lerXlsx(arquivo: File): Promise<PlanilhaLida> {
  const { default: ExcelJS } = await import("exceljs");
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(await arquivo.arrayBuffer());
  const folha = livro.worksheets[0];
  if (!folha) return { cabecalhos: [], linhas: [] };
  const linhas: unknown[][] = [];
  folha.eachRow({ includeEmpty: false }, (row) => {
    const valores = row.values as unknown[];
    // `row.values` é 1-indexado (posição 0 vazia).
    linhas.push(valores.slice(1).map(valorDaCelula));
  });
  const [cabecalhos = [], ...resto] = linhas;
  return { cabecalhos: cabecalhos.map((c) => String(c ?? "")), linhas: resto };
}

export async function lerPlanilha(arquivo: File): Promise<PlanilhaLida> {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".csv") || arquivo.type === "text/csv") return lerCsv(arquivo);
  if (nome.endsWith(".xlsx")) return lerXlsx(arquivo);
  throw new Error("Use um arquivo .xlsx ou .csv.");
}
