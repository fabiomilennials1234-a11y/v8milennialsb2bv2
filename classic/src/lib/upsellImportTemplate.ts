
/** Colunas do modelo de importação de clientes para a Carteira. */
export const UPSELL_TEMPLATE_HEADERS = [
  "Nome",
  "Empresa",
  "Email",
  "Telefone",
  "Potencial",
  "Data Primeira Venda",
  "Vendedor",
  "Etapa",
  "Faturamento",
  "Segmento",
  "Produto",
  "Quantidade",
  "Valor Unitario",
  "Unidade",
  "Data Pedido",
  "CNPJ",
] as const;

/** Linha de exemplo. */
const EXAMPLE_ROW: Record<string, string> = {
  Nome: "Maria Silva",
  Empresa: "Empresa Exemplo Ltda",
  Email: "maria.silva@exemplo.com",
  Telefone: "11999998888",
  Potencial: "Alto",
  "Data Primeira Venda": "15/01/2026",
  Vendedor: "João Silva",
  Etapa: "0-3m",
  Faturamento: "R$100 mil a R$250 mil",
  Segmento: "Varejo",
  Produto: "Produto Exemplo",
  Quantidade: "10",
  "Valor Unitario": "25.00",
  Unidade: "un",
  "Data Pedido": "15/01/2026",
  CNPJ: "00.000.000/0001-00",
};

/** Aba Instruções. */
const INSTRUCOES_ROWS: (string | number)[][] = [
  ["INSTRUÇÕES PARA IMPORTAÇÃO DE CLIENTES — CARTEIRA"],
  [""],
  ["PASSOS:"],
  ["1.", "Baixe este modelo (aba 'Clientes')."],
  ["2.", "Preencha as colunas na aba 'Clientes'. A primeira linha deve manter os nomes das colunas."],
  ["3.", "Salve o arquivo em .xlsx ou .csv (UTF-8)."],
  ["4.", "Na tela de Importar, selecione o arquivo e escolha a etapa e potencial padrão."],
  ["5.", "Se aparecerem colunas não reconhecidas, mapeie cada uma para um campo existente ou ignore."],
  [""],
  ["COLUNAS (o que preencher):"],
  ["Coluna", "Obrigatório?", "Descrição", "Exemplo"],
  ["Nome", "Sim", "Nome completo do cliente ou contato.", "Maria Silva"],
  ["Empresa", "Não", "Nome da empresa ou razão social.", "Empresa Exemplo Ltda"],
  ["Email", "Recomendado", "E-mail de contato.", "maria@exemplo.com"],
  ["Telefone", "Recomendado", "Telefone ou WhatsApp (apenas números ou com DDD). Usado para detectar duplicados.", "11999998888"],
  ["Potencial", "Não", "Potencial do cliente: Baixo, Medio, Alto ou Estrategico. Se vazio, usa o valor padrão selecionado.", "Alto"],
  ["Data Primeira Venda", "Não", "Data da primeira venda (DD/MM/AAAA ou AAAA-MM-DD). Se vazio, usa a data de hoje.", "15/01/2026"],
  ["Vendedor", "Não", "Nome do closer/responsável. O sistema associa ao membro mais parecido na equipe. Se vazio, usa o responsável padrão.", "João Silva"],
  ["Etapa", "Não", "Nome da etapa do funil (ex: 0-3m, 3-6m, Campeões, Fiéis). Se vazio, usa a etapa padrão.", "0-3m"],
  ["Faturamento", "Não", "Faixa de faturamento da empresa.", "R$100 mil a R$250 mil"],
  ["Segmento", "Não", "Segmento ou setor de atuação.", "Varejo"],
  [""],
  ["COLUNAS DE HISTÓRICO DE PEDIDOS (requer plano com Carteira de Clientes):"],
  ["Produto", "Não", "Nome do produto ou item vendido. Quando preenchido, gera um pedido automaticamente.", "Produto Exemplo"],
  ["Quantidade", "Não", "Quantidade vendida do produto (número). Padrão: 1.", "10"],
  ["Valor Unitario", "Não", "Preço unitário do produto (número). Pode conter R$ e vírgula.", "25.00"],
  ["Unidade", "Não", "Unidade de medida: un, kg, l, m, cx, pc etc.", "un"],
  ["Data Pedido", "Não", "Data do pedido (DD/MM/AAAA ou AAAA-MM-DD). Pedidos com a mesma data são agrupados em um único pedido.", "15/01/2026"],
  ["CNPJ", "Não", "CNPJ da empresa do cliente (informativo).", "00.000.000/0001-00"],
  [""],
  ["Dica: Você pode adicionar outras colunas. Na hora de importar, o sistema mostrará as colunas não reconhecidas para você mapear ou ignorar."],
  [""],
  ["VALORES ACEITOS PARA POTENCIAL:"],
  ["Baixo", "", "Também aceita: low"],
  ["Medio", "", "Também aceita: médio, medium"],
  ["Alto", "", "Também aceita: high"],
  ["Estrategico", "", "Também aceita: estratégico, strategic, vip"],
];

/**
 * Gera e faz o download do modelo de importação de clientes (XLSX) com:
 * - Aba "Clientes": cabeçalhos corretos + linha de exemplo
 * - Aba "Instruções": passos e descrição de cada coluna
 */
export async function downloadUpsellImportTemplate(): Promise<void> {
  const ExcelJS = await import("exceljs");
  const headers = [...UPSELL_TEMPLATE_HEADERS];
  const dataRow = headers.map((h) => EXAMPLE_ROW[h] ?? "");

  const workbook = new ExcelJS.Workbook();

  const wsClientes = workbook.addWorksheet("Clientes");
  wsClientes.addRow(headers);
  wsClientes.addRow(dataRow);

  const wsInstrucoes = workbook.addWorksheet("Instruções");
  for (const row of INSTRUCOES_ROWS) {
    wsInstrucoes.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const filename = `modelo_importacao_clientes_carteira_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
