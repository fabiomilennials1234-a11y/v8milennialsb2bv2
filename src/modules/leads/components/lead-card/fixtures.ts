/**
 * Dados de exemplo do Card do Lead — só para a rota de visualização.
 *
 * Escolhidos para exercitar os casos que o desenho precisa aguentar, e não os
 * fáceis. As proporções vêm da medição de prod em 2026-08-04:
 *
 *   - `cliente` COM negócio aberto — 180 leads em prod, o caso que proíbe
 *     colapsar Relação e Situação num status só (ADR-0023 §6);
 *   - negócio ganho junto com aberto — 172 leads;
 *   - campo vazio convivendo com campo cheio — documento, site e nascimento
 *     não existem como coluna hoje e nascem vazios de propósito;
 *   - campo personalizado no meio dos de sistema — 47 orgs usam, média 10,3
 *     por org, 38 na maior;
 *   - nota longa — `notes` está em 74,9% dos leads, é o campo mais escrito
 *     depois de nome, origem e telefone.
 */

import type { LeadCardData } from "./types";

export const LEAD_EXEMPLO: LeadCardData = {
  id: "f1f0a2c4-0000-4000-8000-000000000001",
  nome: "Distética Suplementos",
  empresa: "Distética Comércio de Suplementos Ltda",
  telefone: "(11) 98472-1130",
  email: "compras@distetica.com.br",
  uf: "SP",
  origem: "Indicação",
  criadoEm: "2025-11-12T14:20:00.000Z",

  relacao: "cliente",
  prova: "ambas",
  situacao: { funil: "Orçamentos", funilCor: "#a855f7" },

  dono: { nome: "Luiza Andrade", papel: "Responsável de venda" },
  copilotAtivo: true,

  tags: [
    { id: "t1", nome: "Ouro" },
    { id: "t2", nome: "Recompra" },
    { id: "t3", nome: "Frete grátis" },
  ],

  metricas: {
    acumulado: 44300,
    ticketMedio: 1845.83,
    pedidos: 24,
    cicloDias: 60,
    ultimaCompraDias: 12,
    idadeDias: 266,
    semContatoDias: 3,
  },

  negocios: [
    {
      id: "d1",
      titulo: "Reposição trimestral",
      funil: "Orçamentos",
      funilCor: "#a855f7",
      etapa: "Proposta enviada",
      valor: 12400,
      estado: "aberto",
      diasNaEtapa: 6,
      diasEmAberto: 6,
      etapaIndice: 3,
      etapaTotal: 6,
      // Um negócio COM produto e outros sem — é assim na base, e a bancada de
      // desenho precisa mostrar os dois estados na mesma tela.
      produtos: [
        { nome: "Implante Unitário", quantidade: 2, precoUnitario: 4200, total: 7560, avulso: false },
        { nome: "Enxerto ósseo", quantidade: 1, precoUnitario: 1800, total: 1800, avulso: false },
        { nome: "Taxa de laboratório", quantidade: 1, precoUnitario: 340, total: 340, avulso: true },
      ],
    },
    {
      id: "d2",
      titulo: "Negócio de ago/2026",
      funil: "Qualificação",
      funilCor: "#22c55e",
      etapa: "Respondeu",
      valor: 0,
      estado: "aberto",
      diasNaEtapa: 1,
      diasEmAberto: 1,
      etapaIndice: 1,
      etapaTotal: 5,
      produtos: [],
    },
    {
      id: "d3",
      titulo: "Negócio de mai/2026",
      funil: "Orçamentos",
      funilCor: "#a855f7",
      etapa: "Vendido",
      valor: 19500,
      estado: "ganho",
      diasNaEtapa: null,
      diasEmAberto: null,
      etapaIndice: 5,
      etapaTotal: 6,
      produtos: [],
    },
    {
      id: "d4",
      titulo: "Negócio de jan/2026",
      funil: "Orçamentos",
      funilCor: "#a855f7",
      etapa: "Vendido",
      valor: 12400,
      estado: "ganho",
      diasNaEtapa: null,
      diasEmAberto: null,
      etapaIndice: 5,
      etapaTotal: 6,
      produtos: [],
    },
    {
      id: "d5",
      titulo: "Negócio de nov/2025",
      funil: "Qualificação",
      funilCor: "#22c55e",
      etapa: "Perdido",
      valor: 0,
      estado: "perdido",
      diasNaEtapa: null,
      diasEmAberto: null,
      etapaIndice: 4,
      etapaTotal: 5,
      produtos: [],
    },
  ],

  nota:
    "Compra em ciclo de 60 dias, sempre na primeira quinzena. Prefere falar com a Luiza — " +
    "já pediu para não receber disparo automático. Trabalha com marca própria e pede " +
    "amostra antes de fechar linha nova. CNPJ ainda não confirmado no ERP.",

  campos: [
    {
      titulo: "Perfil",
      campos: [
        { chave: "nome", rotulo: "Nome", valor: "Distética Suplementos", tipo: "texto" },
        { chave: "empresa", rotulo: "Empresa", valor: "Distética Comércio de Suplementos Ltda", tipo: "texto" },
        { chave: "email", rotulo: "E-mail", valor: "compras@distetica.com.br", tipo: "email" },
        { chave: "telefone", rotulo: "Telefone", valor: "(11) 98472-1130", tipo: "telefone" },
        // Campo que o Torque ainda não carrega. Nasce vazio e fica visível —
        // decisão do CTO. Sumir da tela é o que faz ninguém nunca preencher.
        { chave: "documento", rotulo: "CNPJ", valor: null, tipo: "documento", vazio: "Informe o CNPJ" },
        { chave: "site", rotulo: "Site", valor: null, tipo: "url", vazio: "www.exemplo.com.br" },
        { chave: "nascimento", rotulo: "Data de fundação", valor: null, tipo: "data", vazio: "dd/mm/aaaa" },
        // Campos da organização JÁ RESPONDIDOS. Sobem para o Perfil porque é o
        // que o formulário trouxe sobre esta empresa — ver o bloco de decisão
        // em `useLeadCardData`.
        { chave: "c1", rotulo: "Marca própria", valor: "Sim", personalizado: true },
        { chave: "c2", rotulo: "Comprador", valor: "Ellen (compras)", personalizado: true },
        { chave: "c4", rotulo: "Prazo de pagamento", valor: "28 dias", personalizado: true },
      ],
    },
    {
      titulo: "Endereço",
      campos: [
        { chave: "uf", rotulo: "Estado", valor: "SP", tipo: "texto" },
        { chave: "cidade", rotulo: "Cidade", valor: null, tipo: "texto", vazio: "Informe a cidade" },
        { chave: "logradouro", rotulo: "Logradouro", valor: null, tipo: "texto", vazio: "Rua, número" },
        { chave: "cep", rotulo: "CEP", valor: null, tipo: "texto", vazio: "00000-000" },
      ],
    },
    {
      titulo: "Comercial",
      campos: [
        { chave: "origem", rotulo: "Origem", valor: "Indicação", tipo: "texto" },
        { chave: "segmento", rotulo: "Segmento", valor: "Suplementos", tipo: "texto" },
        { chave: "faturamento", rotulo: "Faturamento", valor: "R$ 500 mil – 1 mi", tipo: "moeda" },
        { chave: "qualificacao", rotulo: "Qualificação", valor: null, tipo: "texto", vazio: "Sem qualificação" },
      ],
    },
    {
      titulo: "Campos a preencher",
      campos: [
        { chave: "c3", rotulo: "Transportadora", valor: null, personalizado: true, vazio: "Não informado" },
        { chave: "c5", rotulo: "Volume por pedido", valor: null, personalizado: true, vazio: "Não informado" },
      ],
    },
  ],

  historico: [
    {
      id: "h1",
      tipo: "negocio",
      texto: "Negócio {0} movido de {1} para {2}",
      realces: ["Reposição trimestral", "Orçamento", "Proposta enviada"],
      autor: "Luiza Andrade",
      quando: "2026-08-04T13:41:00.000Z",
    },
    {
      id: "h2",
      tipo: "mensagem",
      texto: "Mensagem enviada no WhatsApp",
      autor: "Luiza Andrade",
      quando: "2026-08-04T12:10:00.000Z",
    },
    {
      // Comentário de verdade: o corpo vem em `comentario`, não em `texto`.
      // O exemplo é longo e tem quebra de linha de propósito — é o formato real
      // (411 dos 2.909 de prod passam de 200 caracteres) e é o que expõe na
      // visualização se o bloco truncar ou colapsar a quebra.
      id: "h3",
      tipo: "comentario",
      texto: "Comentário",
      autor: "Luiza Andrade",
      quando: "2026-08-03T18:02:00.000Z",
      comentario: {
        id: "c1",
        corpo:
          "Pediu amostra da linha nova antes de fechar. Enviar até sexta.\n" +
          "Falou que o preço da concorrência veio 8% abaixo, mas que prefere " +
          "continuar com a gente pelo prazo de entrega. Quem assina é o sócio.",
        editadoEm: null,
        podeEditar: true,
        podeApagar: true,
      },
    },
    {
      id: "h4",
      tipo: "campo",
      texto: "Faturamento alterado de {0} para {1}",
      realces: ["R$ 100 – 500 mil", "R$ 500 mil – 1 mi"],
      autor: "Luiza Andrade",
      quando: "2026-08-01T09:35:00.000Z",
    },
    {
      id: "h5",
      tipo: "negocio",
      texto: "Negócio {0} criado",
      realces: ["Reposição trimestral"],
      autor: "Luiza Andrade",
      quando: "2026-07-28T15:22:00.000Z",
    },
    {
      id: "h6",
      tipo: "automacao",
      texto: "Automação {0} pulou o envio — fora da janela de disparo",
      realces: ["Reativação 60 dias"],
      autor: null,
      quando: "2026-07-21T03:12:00.000Z",
    },
    {
      id: "h7",
      tipo: "negocio",
      texto: "Negócio {0} marcado como {1}",
      realces: ["Negócio de mai/2026", "vendido"],
      autor: "Luiza Andrade",
      quando: "2026-05-19T16:48:00.000Z",
    },
    {
      id: "h8",
      tipo: "lead",
      texto: "Lead criado a partir de {0}",
      realces: ["Indicação"],
      autor: "Marcos Aurélio",
      quando: "2025-11-12T14:20:00.000Z",
    },
  ],
};

/**
 * Segundo exemplo: o estado majoritário da base.
 *
 * 33.036 dos 35.154 leads vivos são `Lead · Em negociação` sem nenhuma compra —
 * 94%. O card precisa ser bonito **vazio**, não só cheio; é assim que ele passa
 * a maior parte do tempo.
 */
export const LEAD_EXEMPLO_MAGRO: LeadCardData = {
  id: "f1f0a2c4-0000-4000-8000-000000000002",
  nome: "Renata Alves",
  empresa: null,
  telefone: "(41) 99612-4408",
  email: null,
  uf: "PR",
  origem: "Meta Ads",
  criadoEm: "2026-08-02T11:05:00.000Z",

  relacao: "lead",
  prova: null,
  situacao: { funil: "Qualificação", funilCor: "#22c55e" },

  dono: null,
  copilotAtivo: true,

  tags: [],

  metricas: {
    acumulado: 0,
    ticketMedio: 0,
    pedidos: 0,
    cicloDias: null,
    ultimaCompraDias: null,
    idadeDias: 2,
    semContatoDias: 1,
  },

  negocios: [
    {
      id: "d1",
      titulo: "Negócio de ago/2026",
      funil: "Qualificação",
      funilCor: "#22c55e",
      etapa: "Abordado",
      valor: 0,
      estado: "aberto",
      diasNaEtapa: 2,
      diasEmAberto: 2,
      etapaIndice: 1,
      etapaTotal: 5,
      produtos: [],
    },
  ],

  nota: "",

  campos: [
    {
      titulo: "Perfil",
      campos: [
        { chave: "nome", rotulo: "Nome", valor: "Renata Alves", tipo: "texto" },
        { chave: "empresa", rotulo: "Empresa", valor: null, tipo: "texto", vazio: "Informe a empresa" },
        { chave: "email", rotulo: "E-mail", valor: null, tipo: "email", vazio: "nome@empresa.com.br" },
        { chave: "telefone", rotulo: "Telefone", valor: "(41) 99612-4408", tipo: "telefone" },
        { chave: "documento", rotulo: "CPF / CNPJ", valor: null, tipo: "documento", vazio: "Informe o documento" },
        { chave: "site", rotulo: "Site", valor: null, tipo: "url", vazio: "www.exemplo.com.br" },
      ],
    },
    {
      titulo: "Endereço",
      campos: [
        { chave: "uf", rotulo: "Estado", valor: "PR", tipo: "texto" },
        { chave: "cidade", rotulo: "Cidade", valor: null, tipo: "texto", vazio: "Informe a cidade" },
      ],
    },
    {
      titulo: "Comercial",
      campos: [
        { chave: "origem", rotulo: "Origem", valor: "Meta Ads", tipo: "texto" },
        { chave: "segmento", rotulo: "Segmento", valor: null, tipo: "texto", vazio: "Informe o segmento" },
        { chave: "faturamento", rotulo: "Faturamento", valor: null, tipo: "moeda", vazio: "Informe o faturamento" },
      ],
    },
  ],

  historico: [
    {
      id: "h1",
      tipo: "mensagem",
      texto: "Copilot respondeu no WhatsApp",
      autor: null,
      quando: "2026-08-03T10:14:00.000Z",
    },
    {
      id: "h2",
      tipo: "negocio",
      texto: "Negócio {0} criado",
      realces: ["Negócio de ago/2026"],
      autor: "Sistema",
      quando: "2026-08-02T11:06:00.000Z",
    },
    {
      id: "h3",
      tipo: "lead",
      texto: "Lead criado a partir de {0}",
      realces: ["Meta Ads"],
      autor: null,
      quando: "2026-08-02T11:05:00.000Z",
    },
  ],
};
