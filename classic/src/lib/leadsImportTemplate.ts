
/** Colunas do modelo de importação de leads (igual ao esperado pelo sistema). */
export const LEADS_TEMPLATE_HEADERS = [
  "Nome",
  "Empresa",
  "Email",
  "Telefone",
  "Faturamento",
  "Segmento",
  "Notas",
  "Público de origem",
  "Etapa",
  "Vendedor",
  "Valor",
  "Produto",
  "Data Compromisso",
  "Tempo C",
  "Observações etapa",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
] as const;

/** Uma linha de exemplo para o modelo. */
const EXAMPLE_ROW: Record<string, string> = {
  Nome: "Maria Silva",
  Empresa: "Empresa Exemplo Ltda",
  Email: "maria.silva@exemplo.com",
  Telefone: "11999998888",
  Faturamento: "R$100 mil a R$250 mil",
  Segmento: "Varejo",
  Notas: "Lead qualificado em evento.",
  "Público de origem": "Site",
  Etapa: "Reunião Marcada",
  Vendedor: "João Silva",
  Valor: "15000",
  Produto: "Plano Mensal",
  "Data Compromisso": "15/02/2026",
  "Tempo C": "12",
  "Observações etapa": "Cliente pediu proposta até sexta.",
  utm_campaign: "campanha_verao",
  utm_source: "google",
  utm_medium: "cpc",
  utm_content: "",
  utm_term: "",
};

/** Conteúdo da aba Instruções: passos e descrição de cada coluna. */
const INSTRUCOES_ROWS: (string | number)[][] = [
  ["INSTRUÇÕES PARA IMPORTAÇÃO DE LEADS"],
  [""],
  ["PASSOS:"],
  ["1.", "Baixe este modelo (aba 'Leads')."],
  ["2.", "Preencha as colunas na aba 'Leads'. A primeira linha deve manter os nomes das colunas."],
  ["3.", "Salve o arquivo em .xlsx ou .csv (UTF-8)."],
  ["4.", "Na tela de Importar leads, selecione o arquivo e escolha a etapa padrão (usada quando a coluna Etapa estiver vazia)."],
  ["5.", "Se aparecerem colunas não reconhecidas, mapeie cada uma para um campo existente ou crie um campo personalizado em Configurações → Leads."],
  [""],
  ["COLUNAS (o que preencher):"],
  ["Coluna", "Obrigatório?", "Descrição", "Exemplo"],
  ["Nome", "Sim", "Nome completo da pessoa ou do contato.", "Maria Silva"],
  ["Empresa", "Não", "Nome da empresa ou razão social.", "Empresa Exemplo Ltda"],
  ["Email", "Recomendado*", "E-mail de contato. *Precisa ter Email ou Telefone.", "maria@exemplo.com"],
  ["Telefone", "Recomendado*", "Telefone ou WhatsApp (apenas números ou com DDD).", "11999998888"],
  ["Faturamento", "Não", "Faixa de faturamento da empresa.", "R$100 mil a R$250 mil"],
  ["Segmento", "Não", "Segmento ou setor de atuação.", "Varejo"],
  ["Notas", "Não", "Observações ou comentários sobre o lead.", "Lead do evento X"],
  ["Público de origem", "Não", "Origem do lead (ex: Site, WhatsApp, Indicação).", "Site"],
  ["Etapa", "Não", "Nome da etapa do funil (ex: Novo, Reunião Marcada, Confirmar D-5). O sistema identifica automaticamente e posiciona cada lead na etapa correta. Colunas alternativas: Stage, Estágio, Fase. Se vazio, usa a etapa padrão.", "Reunião Marcada"],
  ["Vendedor", "Não", "Nome do vendedor/responsável ou do time. O sistema associa ao membro mais parecido na equipe. Colunas alternativas: Time, Equipe, Responsável, SDR, Closer. Se vazio, usa o responsável padrão.", "João Silva"],
  ["Valor", "Não", "Valor da proposta em número (ex: 15000 ou R$ 15.000,00). Usado em funis de fechamento.", "15000"],
  ["Produto", "Não", "Nome do(s) produto(s). Vários produtos: separe por vírgula ou ponto e vírgula (ex: Plano Mensal; Plano Anual). O sistema associa ao produto com nome mais parecido no cadastro e vincula todos ao lead. Usado em funis de fechamento.", "Plano Mensal"],
  ["Data Compromisso", "Não", "Data do compromisso/reunião (DD/MM/AAAA ou AAAA-MM-DD).", "15/02/2026"],
  ["Tempo C", "Não", "Tempo de contrato em meses (número). Ex: 12 para 12 meses.", "12"],
  ["Observações etapa", "Não", "Observações específicas da etapa no funil (ex: notas da proposta, do compromisso).", "Cliente pediu proposta até sexta."],
  ["utm_campaign", "Não", "Parâmetro UTM: campanha.", "campanha_verao"],
  ["utm_source", "Não", "Parâmetro UTM: fonte.", "google"],
  ["utm_medium", "Não", "Parâmetro UTM: meio.", "cpc"],
  ["utm_content", "Não", "Parâmetro UTM: conteúdo.", ""],
  ["utm_term", "Não", "Parâmetro UTM: termo.", ""],
  [""],
  ["Dica: Você pode adicionar outras colunas no arquivo. Na hora de importar, o sistema mostrará as colunas não reconhecidas para você mapear ou ignorar."],
];

/**
 * Gera e faz o download do modelo de importação de leads (XLSX) com:
 * - Aba "Leads": cabeçalhos corretos + linha de exemplo
 * - Aba "Instruções": passos e descrição de cada coluna
 */
export async function downloadLeadsImportTemplate(): Promise<void> {
  const ExcelJS = await import("exceljs");
  const headers = [...LEADS_TEMPLATE_HEADERS];
  const dataRow = headers.map((h) => EXAMPLE_ROW[h] ?? "");

  const workbook = new ExcelJS.Workbook();

  const wsLeads = workbook.addWorksheet("Leads");
  wsLeads.addRow(headers);
  wsLeads.addRow(dataRow);

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
  const filename = `modelo_importacao_leads_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
