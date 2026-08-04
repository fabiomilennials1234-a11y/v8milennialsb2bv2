import type { DealCardData } from "./types";

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

const ETAPAS_ORCAMENTOS = [
  { chave: "orcamento", nome: "Orçamento", papel: "aberto" as const },
  { chave: "proposta_enviada", nome: "Proposta enviada", papel: "aberto" as const },
  { chave: "negociacao", nome: "Em negociação", papel: "aberto" as const },
  { chave: "vendido", nome: "Vendido", papel: "ganho" as const },
  { chave: "perdido", nome: "Perdido", papel: "perdido" as const },
];

/** O caso que a operação precisa ver: parado muito acima da mediana da etapa. */
export const NEGOCIO_ESTAGNADO: DealCardData = {
  id: "e1",
  titulo: "Reposição trimestral",
  estado: "aberto",
  lead: {
    id: "l1",
    nome: "Distética Suplementos",
    empresa: "Distética Comércio de Suplementos Ltda",
    telefone: "(11) 98472-1130",
    relacao: "cliente",
  },
  funil: "Orçamentos",
  funilCor: "#a855f7",
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
      quando: "2026-05-22T13:41:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
    {
      id: "m2",
      de: "Em negociação",
      para: "Orçamento",
      quando: "2026-05-04T10:12:00.000Z",
      autor: null,
      origem: "automacao",
    },
    {
      id: "m1",
      de: null,
      para: "Em negociação",
      quando: "2026-04-30T09:02:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
  ],
  nota: "Aguardando aprovação do sócio. Ligar de novo na semana do dia 10.",
};

/** 98,9% dos negócios: sem valor, uma movimentação só, recém-criado. */
export const NEGOCIO_MAGRO: DealCardData = {
  id: "e2",
  titulo: "Negócio de ago/2026",
  estado: "aberto",
  lead: {
    id: "l2",
    nome: "Renata Alves",
    empresa: null,
    telefone: "(41) 99612-4408",
    relacao: "lead",
  },
  funil: "Qualificação",
  funilCor: "#22c55e",
  etapas: [
    { chave: "novo", nome: "Novo lead", papel: "aberto" },
    { chave: "abordado", nome: "Abordado", papel: "aberto" },
    { chave: "respondeu", nome: "Respondeu", papel: "aberto" },
    { chave: "agendado", nome: "Agendado", papel: "aberto" },
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
      quando: "2026-08-02T11:06:00.000Z",
      autor: null,
      origem: "sistema",
    },
  ],
  nota: "",
};

/** Fechado: o desfecho substitui o bloco de tempo, que deixou de apontar ação. */
export const NEGOCIO_GANHO: DealCardData = {
  id: "e3",
  titulo: "Negócio de mai/2026",
  estado: "ganho",
  lead: {
    id: "l1",
    nome: "Distética Suplementos",
    empresa: "Distética Comércio de Suplementos Ltda",
    telefone: "(11) 98472-1130",
    relacao: "cliente",
  },
  funil: "Orçamentos",
  funilCor: "#a855f7",
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
      quando: "2026-05-19T16:48:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
    {
      id: "m1",
      de: null,
      para: "Proposta enviada",
      quando: "2026-04-08T14:20:00.000Z",
      autor: "Luiza Andrade",
      origem: "manual",
    },
  ],
  nota: "",
};
