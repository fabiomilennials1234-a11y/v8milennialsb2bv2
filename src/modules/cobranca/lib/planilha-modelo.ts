/**
 * Planilha modelo para importar inadimplentes (.xlsx).
 *
 * Duas abas:
 *  - "Modelo": só o cabeçalho (linha 1) e linhas em branco já formatadas. O
 *    leitor (`ler-planilha.ts`) usa a PRIMEIRA aba e trata a linha 1 como
 *    cabeçalho — por isso nada de exemplo aqui: qualquer linha preenchida seria
 *    importada como devedor de verdade.
 *  - "Instruções": o que é obrigatório ou opcional, o que preencher e exemplos.
 *
 * Os cabeçalhos são reconhecidos por `detectarColunas` (planilha.ts); o teste
 * `planilha-modelo.test.ts` garante que continuam sendo.
 *
 * exceljs é carregado sob demanda — é pesado e só o import/modelo o usam.
 */
import type { DataValidation } from "exceljs";

export const NOME_DO_ARQUIVO_MODELO = "modelo-importacao-inadimplentes.xlsx";
export const ABA_DO_MODELO = "Modelo";
export const ABA_DE_INSTRUCOES = "Instruções";

const MARCA_OBRIGATORIO = "obrigatório";
const MARCA_OPCIONAL = "opcional";

/** Linhas formatadas (e validadas) abaixo do cabeçalho. O limite de importação é 2.000. */
const LINHAS_FORMATADAS = 500;

interface ColunaDoModelo {
  cabecalho: string;
  obrigatorio: boolean;
  largura: number;
  /** Nome curto na aba de instruções. */
  coluna: string;
  preencher: string;
  exemplo: string;
}

/** A ordem aqui é a ordem das colunas na planilha. */
export const COLUNAS_DO_MODELO: ColunaDoModelo[] = [
  {
    cabecalho: `Nome (${MARCA_OBRIGATORIO})`,
    obrigatorio: true,
    largura: 34,
    coluna: "Nome",
    preencher: "Nome da pessoa ou razão social do devedor.",
    exemplo: "Mercado Boa Vista Ltda",
  },
  {
    cabecalho: `Contato - telefone com DDD (${MARCA_OBRIGATORIO})`,
    obrigatorio: true,
    largura: 30,
    coluna: "Contato - telefone com DDD",
    preencher: "Telefone com DDD, de preferência o WhatsApp. Pode usar parênteses, espaço e traço.",
    exemplo: "(48) 99999-0001",
  },
  {
    cabecalho: `Valor (${MARCA_OBRIGATORIO})`,
    obrigatorio: true,
    largura: 18,
    coluna: "Valor",
    preencher: "Valor em aberto do título, em reais, maior que zero.",
    exemplo: "1234,56",
  },
  {
    cabecalho: `Data de vencimento (${MARCA_OBRIGATORIO})`,
    obrigatorio: true,
    largura: 24,
    coluna: "Data de vencimento",
    preencher: "Data em que o título venceu, no formato dd/mm/aaaa.",
    exemplo: "25/11/2026",
  },
  {
    cabecalho: `Responsável (${MARCA_OPCIONAL})`,
    obrigatorio: false,
    largura: 26,
    coluna: "Responsável",
    preencher:
      "Quem cuida da cobrança deste devedor: o nome do membro exatamente como aparece no Torque, ou o e-mail dele. Deixe vazio para ficar sem responsável.",
    exemplo: "Maria Souza",
  },
  {
    cabecalho: `Observação (${MARCA_OPCIONAL})`,
    obrigatorio: false,
    largura: 40,
    coluna: "Observação",
    preencher: "Qualquer anotação sobre o devedor ou o título.",
    exemplo: "Pediu retorno depois do dia 10",
  },
];

const REGRAS = [
  "Uma linha por título em aberto. O mesmo devedor com vários títulos repete o Nome e o Contato em linhas diferentes.",
  "Datas em dd/mm/aaaa (exemplo: 25/11/2026).",
  "Valor em reais, com vírgula nos centavos (exemplo: 1234,56).",
  "Responsável: o nome do membro exatamente como aparece no Torque, ou o e-mail dele. Se o nome não for encontrado, a linha não entra.",
  "Até 2.000 linhas por importação.",
  "Não renomeie as colunas nem insira linhas acima do cabeçalho: a primeira linha da aba Modelo precisa ser o cabeçalho.",
  "Reimportar a mesma planilha não duplica: o devedor é reconhecido pelo contato.",
  "As linhas em branco da aba Modelo são ignoradas na importação.",
];

// Neutras de propósito: a diferença entre obrigatório e opcional é de peso, não de cor viva.
const COR_OBRIGATORIO_FUNDO = "FF1F2937";
const COR_OBRIGATORIO_TEXTO = "FFFFFFFF";
const COR_OPCIONAL_FUNDO = "FFE5E7EB";
const COR_OPCIONAL_TEXTO = "FF111827";

const BORDA = { style: "thin" as const, color: { argb: "FFD1D5DB" } };

/** O conteúdo do .xlsx. Separado do download para poder ser lido de volta nos testes. */
export async function gerarBufferDoModelo(): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const livro = new ExcelJS.Workbook();
  livro.creator = "Torque CRM";

  // ── Aba "Modelo" (precisa ser a primeira) ────────────────────────────────
  const modelo = livro.addWorksheet(ABA_DO_MODELO, { views: [{ state: "frozen", ySplit: 1 }] });
  modelo.columns = COLUNAS_DO_MODELO.map((c) => ({ width: c.largura }));

  const cabecalho = modelo.getRow(1);
  cabecalho.height = 30;
  COLUNAS_DO_MODELO.forEach((c, i) => {
    const celula = cabecalho.getCell(i + 1);
    celula.value = c.cabecalho;
    celula.font = { bold: true, color: { argb: c.obrigatorio ? COR_OBRIGATORIO_TEXTO : COR_OPCIONAL_TEXTO } };
    celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.obrigatorio ? COR_OBRIGATORIO_FUNDO : COR_OPCIONAL_FUNDO } };
    celula.alignment = { vertical: "middle", wrapText: true };
    celula.border = { top: BORDA, left: BORDA, bottom: BORDA, right: BORDA };
    celula.note = c.obrigatorio
      ? `Campo OBRIGATÓRIO. ${c.preencher}`
      : `Campo OPCIONAL. ${c.preencher}`;
  });

  const ultima = LINHAS_FORMATADAS + 1;
  for (let linha = 2; linha <= ultima; linha += 1) {
    const contato = modelo.getCell(linha, 2);
    contato.numFmt = "@"; // texto: não perde o zero nem vira número científico
    const valor = modelo.getCell(linha, 3);
    valor.numFmt = '"R$" #,##0.00';
    const vencimento = modelo.getCell(linha, 4);
    vencimento.numFmt = "dd/mm/yyyy";
  }
  // Uma validação por faixa: atribuir célula a célula faz o exceljs gravar faixas
  // sobrepostas, e o Excel abre esse arquivo pedindo "reparo". `dataValidations`
  // existe em runtime, mas o index.d.ts do exceljs não o declara em Worksheet.
  const validacoes = (modelo as unknown as { dataValidations: { add(faixa: string, regra: DataValidation): void } })
    .dataValidations;
  validacoes.add(`C2:C${ultima}`, {
    type: "decimal",
    operator: "greaterThan",
    formulae: [0],
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: "stop",
    errorTitle: "Valor inválido",
    error: "Informe o valor em reais, maior que zero.",
  });
  validacoes.add(`D2:D${ultima}`, {
    type: "date",
    operator: "greaterThan",
    formulae: [new Date(Date.UTC(2000, 0, 1))],
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: "stop",
    errorTitle: "Data inválida",
    error: "Informe a data de vencimento no formato dd/mm/aaaa.",
  });

  // ── Aba "Instruções" ─────────────────────────────────────────────────────
  const instrucoes = livro.addWorksheet(ABA_DE_INSTRUCOES);
  instrucoes.columns = [{ width: 30 }, { width: 22 }, { width: 70 }, { width: 30 }];

  const titulo = instrucoes.getCell("A1");
  titulo.value = "Como preencher a planilha de inadimplentes";
  titulo.font = { bold: true, size: 14 };
  instrucoes.mergeCells("A1:D1");

  const legenda = instrucoes.getCell("A2");
  legenda.value =
    "Colunas com fundo escuro são OBRIGATÓRIAS; com fundo claro são OPCIONAIS. Preencha na aba Modelo, a partir da linha 2.";
  legenda.alignment = { wrapText: true, vertical: "top" };
  instrucoes.mergeCells("A2:D2");
  instrucoes.getRow(2).height = 32;

  const cabecalhoDaTabela = instrucoes.getRow(4);
  ["Coluna", "Obrigatória ou opcional", "O que preencher", "Exemplo"].forEach((texto, i) => {
    const celula = cabecalhoDaTabela.getCell(i + 1);
    celula.value = texto;
    celula.font = { bold: true };
    celula.border = { bottom: { style: "medium", color: { argb: "FF111827" } } };
  });

  COLUNAS_DO_MODELO.forEach((c, i) => {
    const linha = instrucoes.getRow(5 + i);
    linha.getCell(1).value = c.coluna;
    linha.getCell(1).font = { bold: true };
    const marca = linha.getCell(2);
    marca.value = c.obrigatorio ? "OBRIGATÓRIA" : "OPCIONAL";
    marca.font = { bold: true, color: { argb: c.obrigatorio ? COR_OBRIGATORIO_TEXTO : COR_OPCIONAL_TEXTO } };
    marca.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.obrigatorio ? COR_OBRIGATORIO_FUNDO : COR_OPCIONAL_FUNDO } };
    marca.alignment = { horizontal: "center", vertical: "middle" };
    linha.getCell(3).value = c.preencher;
    linha.getCell(4).value = c.exemplo;
    [1, 3, 4].forEach((n) => {
      linha.getCell(n).alignment = { wrapText: true, vertical: "middle" };
    });
    linha.height = c.preencher.length > 90 ? 48 : 30;
  });

  const inicioDasRegras = 5 + COLUNAS_DO_MODELO.length + 1;
  const tituloDasRegras = instrucoes.getCell(inicioDasRegras, 1);
  tituloDasRegras.value = "Regras";
  tituloDasRegras.font = { bold: true, size: 12 };
  REGRAS.forEach((regra, i) => {
    const celula = instrucoes.getCell(inicioDasRegras + 1 + i, 1);
    celula.value = `${i + 1}. ${regra}`;
    celula.alignment = { wrapText: true, vertical: "top" };
    instrucoes.mergeCells(inicioDasRegras + 1 + i, 1, inicioDasRegras + 1 + i, 4);
    instrucoes.getRow(inicioDasRegras + 1 + i).height = regra.length > 110 ? 32 : 18;
  });

  return (await livro.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function gerarPlanilhaModelo(): Promise<Blob> {
  return new Blob([await gerarBufferDoModelo()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Gera o modelo e dispara o download no navegador. */
export async function baixarPlanilhaModelo(): Promise<void> {
  const arquivo = await gerarPlanilhaModelo();
  const url = URL.createObjectURL(arquivo);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = NOME_DO_ARQUIVO_MODELO;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
