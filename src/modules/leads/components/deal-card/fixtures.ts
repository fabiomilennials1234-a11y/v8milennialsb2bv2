import type { DealCardComentario, DealCardData } from "./types";

/**
 * Exemplos do Card do Negócio — só para a rota de visualização.
 *
 * Escolhidos pelos casos que a medição de prod (04/08/2026) diz serem os reais,
 * e não pelos bonitos:
 *
 *   - o negócio ESTAGNADO é o caso comum, não a exceção: 22.060 dos 38.403
 *     abertos estão parados há mais de 30 dias, mediana de 42;
 *   - o negócio SEM VALOR é 98,9% deles — `sale_value` existe em 1,1%;
 *   - o negócio com UMA movimentação só é 91% deles (média 1,16).
 */

/**
 * Comentários da bancada de desenho.
 *
 * Os três casos que o bloco precisa aguentar e que só aparecem juntos em base
 * de verdade: um comentário deste negócio, um do LEAD (sem vínculo, herdado de
 * antes de a coluna existir — 100% dos 2.885 de prod são assim) e um escrito em
 * OUTRO negócio da mesma pessoa, que é o único que ganha selo.
 */
export const COMENTARIOS_EXEMPLO: DealCardComentario[] = [
  {
    id: "c1",
    corpo:
      "Comprador pediu para refazer a proposta com prazo de 30 dias em vez de 15. Disse que aprova ainda esta semana se o prazo entrar.",
    autor: "Luiza Andrade",
    autorAvatar: null,
    criadoEm: "2026-08-22T17:32:00.000Z",
    editadoEm: null,
    deOutroNegocio: null,
    podeEditar: true,
    podeApagar: true,
  },
  {
    id: "c2",
    corpo: "Falar depois das 15h — antes disso ele está na fábrica e não atende.",
    autor: "Marcos Teixeira",
    autorAvatar: null,
    criadoEm: "2026-08-19T12:05:00.000Z",
    editadoEm: "2026-08-19T12:11:00.000Z",
    deOutroNegocio: null,
    podeEditar: false,
    podeApagar: false,
  },
  {
    id: "c3",
    corpo: "Já comprou a linha básica em janeiro e ficou satisfeito. Vale puxar o histórico na conversa.",
    autor: "Marcos Teixeira",
    autorAvatar: null,
    criadoEm: "2026-06-04T14:20:00.000Z",
    editadoEm: null,
    deOutroNegocio: "Primeira compra",
    podeEditar: false,
    podeApagar: false,
  },
];

const ETAPAS_ORCAMENTOS = [
  { chave: "orcamento", chaveEntry: "orcamento", nome: "Orçamento", papel: "aberto" as const },
  { chave: "proposta_enviada", chaveEntry: "proposta_enviada", nome: "Proposta enviada", papel: "aberto" as const },
  { chave: "negociacao", chaveEntry: "negociacao", nome: "Em negociação", papel: "aberto" as const },
  { chave: "vendido", chaveEntry: "vendido", nome: "Vendido", papel: "ganho" as const },
  { chave: "perdido", chaveEntry: "perdido", nome: "Perdido", papel: "perdido" as const },
];

/** O caso que a operação precisa ver: parado muito acima da mediana da etapa. */
export const NEGOCIO_ESTAGNADO: DealCardData = {
  id: "e1",
  // A fixture tem negócio de verdade: é o caso em que o bloco de produtos é
  // editável, que é o que a tela de visualização precisa mostrar.
  dealId: "d1",
  titulo: "Reposição trimestral",
  estado: "aberto",
  lead: {
    id: "l1",
    nome: "Distética Suplementos",
    empresa: "Distética Comércio de Suplementos Ltda",
    telefone: "(11) 98472-1130",
    relacao: "cliente",
    email: null,
    origem: null,
    chegouEm: null,
    qualificacao: null,
    preQualificacao: null,
    responsaveis: { preVenda: null, venda: null },
    etiquetas: [],
    faturamento: null,
  },
  funil: "Orçamentos",
  funilCor: "#a855f7",
  funilEhSystem: true,
  etapas: ETAPAS_ORCAMENTOS,
  etapaAtual: "proposta_enviada",
  dono: "Luiza Andrade",
  diasEmAberto: 96,
  diasNaEtapa: 74,
  medianaDaEtapa: 21,
  valor: 12400,
  moeda: "BRL",
  produto: "Linha Performance 5kg",
  reuniao: { data: "2026-06-18T14:00:00.000Z", confirmada: true, link: null },
  desfecho: null,
  movimentacoes: [
    {
      id: "m3",
      de: "Orçamento",
      para: "Proposta enviada",
      paraChave: "proposta_enviada",
      quando: "2026-05-22T13:41:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
    {
      id: "m2",
      de: "Em negociação",
      para: "Orçamento",
      paraChave: "orcamento",
      quando: "2026-05-04T10:12:00.000Z",
      autor: null,
      origem: "automacao",
    },
    {
      id: "m1",
      de: null,
      para: "Em negociação",
      paraChave: "negociacao",
      quando: "2026-04-30T09:02:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
  ],
  nota: "Aguardando aprovação do sócio. Ligar de novo na semana do dia 10.",
  valorDoNegocio: null,
  probabilidade: null,
  previsaoFechamento: "2026-09-15",
  fechadoEm: null,
  criadoEm: "2026-04-30T09:02:00.000Z",
  /**
   * A bancada de desenho nunca tinha renderizado uma linha de produto: as três
   * fixtures nasceram com `itens: []`, então a tabela, o cabeçalho de colunas,
   * o selo "avulso", o desconto por linha e os rodapés eram desenho no escuro.
   *
   * Os três casos que importam estão aqui de propósito: catálogo com desconto,
   * catálogo sem desconto e **avulso** (`produtoId: null`).
   */
  itens: [
    {
      id: "i1",
      nome: "Implante Unitário",
      quantidade: 2,
      precoUnitario: 4200,
      total: 7560,
      produtoId: "p1",
      descontoPercent: 10,
      ordem: 0,
    },
    {
      id: "i2",
      nome: "Enxerto ósseo",
      quantidade: 1,
      precoUnitario: 1800,
      total: 1800,
      produtoId: "p2",
      descontoPercent: 0,
      ordem: 1,
    },
    {
      id: "i3",
      nome: "Taxa de laboratório",
      quantidade: 1,
      precoUnitario: 340,
      total: 340,
      produtoId: null,
      descontoPercent: 0,
      ordem: 2,
    },
  ],
  atividades: [
    {
      id: "a1",
      tipo: "call",
      titulo: "Ligação de acompanhamento",
      descricao: "Sócio pediu para retomar depois do dia 10.",
      resultado: "atendeu",
      automatica: false,
      quando: "2026-06-02T17:20:00.000Z",
      concluida: true,
    },
    {
      id: "a2",
      tipo: "meeting",
      titulo: "Apresentar a proposta revisada",
      descricao: null,
      resultado: null,
      automatica: false,
      quando: "2026-08-28T13:00:00.000Z",
      concluida: false,
    },
  ],
  outrosNegocios: [
    {
      id: "e1",
      titulo: "Reposição trimestral",
      funil: "Orçamentos",
      funilCor: "#a855f7",
      etapa: "Proposta enviada",
      valor: 12400,
      estado: "aberto",
      diasNaEtapa: 74,
      diasEmAberto: 96,
      etapaIndice: 1,
      etapaTotal: 3,
      produtos: [],
    },
    {
      id: "e0",
      titulo: "Primeira compra",
      funil: "Qualificação",
      funilCor: "#22c55e",
      etapa: "Vendido",
      valor: 3100,
      estado: "ganho",
      diasNaEtapa: 210,
      diasEmAberto: 240,
      etapaIndice: null,
      etapaTotal: 4,
      produtos: [],
    },
  ],
};

/** 98,9% dos negócios: sem valor, uma movimentação só, recém-criado. */
export const NEGOCIO_MAGRO: DealCardData = {
  id: "e2",
  // Sem linha em `deals` — o caso da MAIORIA das entradas em produção. É o que
  // faz a visualização mostrar o bloco de produtos sem botão, com a frase que
  // explica a ausência.
  dealId: null,
  titulo: "Negócio de ago/2026",
  estado: "aberto",
  lead: {
    id: "l2",
    nome: "Renata Alves",
    empresa: null,
    telefone: "(41) 99612-4408",
    relacao: "lead",
    email: null,
    origem: null,
    chegouEm: null,
    qualificacao: null,
    preQualificacao: null,
    responsaveis: { preVenda: null, venda: null },
    etiquetas: [],
    faturamento: null,
  },
  funil: "Qualificação",
  funilCor: "#22c55e",
  funilEhSystem: true,
  etapas: [
    { chave: "novo", chaveEntry: "novo", nome: "Novo lead", papel: "aberto" },
    { chave: "abordado", chaveEntry: "abordado", nome: "Abordado", papel: "aberto" },
    { chave: "respondeu", chaveEntry: "respondeu", nome: "Respondeu", papel: "aberto" },
    { chave: "agendado", chaveEntry: "agendado", nome: "Agendado", papel: "aberto" },
  ],
  etapaAtual: "abordado",
  dono: null,
  diasEmAberto: 2,
  diasNaEtapa: 2,
  medianaDaEtapa: 9,
  valor: 0,
  moeda: "BRL",
  produto: null,
  reuniao: null,
  desfecho: null,
  movimentacoes: [
    {
      id: "m1",
      de: null,
      para: "Abordado",
      paraChave: "abordado",
      quando: "2026-08-02T11:06:00.000Z",
      autor: null,
      origem: "sistema",
    },
  ],
  nota: "",
  valorDoNegocio: null,
  probabilidade: null,
  previsaoFechamento: null,
  fechadoEm: null,
  criadoEm: "2026-08-19T11:40:00.000Z",
  itens: [],
  atividades: [],
  outrosNegocios: [
    {
      id: "e2",
      titulo: "Negócio de ago/2026",
      funil: "Qualificação",
      funilCor: "#22c55e",
      etapa: "Abordado",
      valor: 0,
      estado: "aberto",
      diasNaEtapa: 2,
      diasEmAberto: 2,
      etapaIndice: 1,
      etapaTotal: 4,
      produtos: [],
    },
  ],
};

/** Fechado: o desfecho substitui o bloco de tempo, que deixou de apontar ação. */
export const NEGOCIO_GANHO: DealCardData = {
  id: "e3",
  dealId: "d3",
  titulo: "Negócio de mai/2026",
  estado: "ganho",
  lead: {
    id: "l1",
    nome: "Distética Suplementos",
    empresa: "Distética Comércio de Suplementos Ltda",
    telefone: "(11) 98472-1130",
    relacao: "cliente",
    email: null,
    origem: null,
    chegouEm: null,
    qualificacao: null,
    preQualificacao: null,
    responsaveis: { preVenda: null, venda: null },
    etiquetas: [],
    faturamento: null,
  },
  funil: "Orçamentos",
  funilCor: "#a855f7",
  funilEhSystem: true,
  etapas: ETAPAS_ORCAMENTOS,
  etapaAtual: "vendido",
  dono: "Luiza Andrade",
  diasEmAberto: 41,
  diasNaEtapa: 77,
  medianaDaEtapa: 21,
  valor: 19500,
  moeda: "BRL",
  produto: "Linha Performance 5kg",
  reuniao: { data: "2026-05-06T15:30:00.000Z", confirmada: true, link: null },
  desfecho: { quando: "2026-05-19T16:48:00.000Z", valorVenda: 19500, motivo: null },
  movimentacoes: [
    {
      id: "m2",
      de: "Proposta enviada",
      para: "Vendido",
      paraChave: "vendido",
      quando: "2026-05-19T16:48:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
    {
      id: "m1",
      de: null,
      para: "Proposta enviada",
      paraChave: "proposta_enviada",
      quando: "2026-04-08T14:20:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
  ],
  nota: "",
  valorDoNegocio: null,
  probabilidade: null,
  previsaoFechamento: null,
  fechadoEm: null,
  criadoEm: "2026-03-11T14:05:00.000Z",
  itens: [],
  atividades: [],
  outrosNegocios: [],
};
