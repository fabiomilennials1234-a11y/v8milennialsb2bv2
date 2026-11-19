import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { ABA_DE_INSTRUCOES, ABA_DO_MODELO, COLUNAS_DO_MODELO, gerarBufferDoModelo, gerarPlanilhaModelo } from "./planilha-modelo";
import { camposFaltando, detectarColunas, montarLinhas } from "./planilha";

async function lerDeVolta() {
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(await gerarBufferDoModelo());
  return livro;
}

/** O mesmo caminho do leitor da tela (`lerXlsx`): primeira aba, linhas com valor, linha 1 = cabeçalho. */
async function comoOLeitorLe() {
  const livro = await lerDeVolta();
  const folha = livro.worksheets[0];
  const linhas: unknown[][] = [];
  folha.eachRow({ includeEmpty: false }, (row) => {
    linhas.push((row.values as unknown[]).slice(1));
  });
  const [cabecalhos = [], ...resto] = linhas;
  return { cabecalhos: cabecalhos.map((c) => String(c ?? "")), linhas: resto };
}

describe("planilha modelo", () => {
  it("entrega um .xlsx", async () => {
    const arquivo = await gerarPlanilhaModelo();
    expect(arquivo.size).toBeGreaterThan(0);
    expect(arquivo.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("a primeira aba é o Modelo e a segunda são as Instruções", async () => {
    const livro = await lerDeVolta();
    expect(livro.worksheets.map((w) => w.name)).toEqual([ABA_DO_MODELO, ABA_DE_INSTRUCOES]);
  });

  it("marca no cabeçalho o que é obrigatório e o que é opcional", async () => {
    const { cabecalhos } = await comoOLeitorLe();
    expect(cabecalhos).toHaveLength(6);
    cabecalhos.slice(0, 4).forEach((c) => expect(c).toContain("(obrigatório)"));
    cabecalhos.slice(4).forEach((c) => expect(c).toContain("(opcional)"));
    expect(COLUNAS_DO_MODELO.filter((c) => c.obrigatorio).map((c) => c.coluna)).toEqual([
      "Nome",
      "Contato - telefone com DDD",
      "Valor",
      "Data de vencimento",
    ]);
  });

  it("os cabeçalhos são reconhecidos pela importação", async () => {
    const { cabecalhos } = await comoOLeitorLe();
    const mapa = detectarColunas(cabecalhos);
    expect(mapa).toMatchObject({ nome: 0, telefone: 1, valor: 2, vencimento: 3, responsavel: 4, observacoes: 5 });
    expect(mapa.contato_nome).toBe(-1);
    expect(camposFaltando(mapa)).toEqual([]);
  });

  it("as validações de dados são uma por faixa, sem sobreposição (o Excel pede reparo se sobrepõem)", async () => {
    // O exceljs grava faixas sobrepostas quando a validação é atribuída célula a célula.
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await gerarBufferDoModelo());
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const faixas = [...xml.matchAll(/<dataValidation [^>]*sqref="([^"]+)"/g)].map((m) => m[1]);
    expect(faixas).toEqual(["C2:C501", "D2:D501"]);
  }, 60_000);

  it("não traz nenhuma linha de dados: nada seria importado sem preencher", async () => {
    const { cabecalhos, linhas } = await comoOLeitorLe();
    expect(linhas).toEqual([]);
    expect(montarLinhas(linhas, detectarColunas(cabecalhos)).linhas).toEqual([]);
  });

  it("as instruções dizem por extenso obrigatória e opcional para cada coluna", async () => {
    const livro = await lerDeVolta();
    const instrucoes = livro.getWorksheet(ABA_DE_INSTRUCOES);
    const marcas: string[] = [];
    instrucoes?.eachRow((row) => {
      const v = String(row.getCell(2).value ?? "");
      if (v === "OBRIGATÓRIA" || v === "OPCIONAL") marcas.push(v);
    });
    expect(marcas).toEqual(["OBRIGATÓRIA", "OBRIGATÓRIA", "OBRIGATÓRIA", "OBRIGATÓRIA", "OPCIONAL", "OPCIONAL"]);
  });
});
