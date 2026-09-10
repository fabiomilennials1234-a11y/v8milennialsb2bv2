/**
 * O catálogo do Oráculo — o que o modelo pode pedir, e quem executa.
 *
 * Os dois lados moram aqui de propósito. O laço rejeita em silêncio qualquer
 * chamada a ferramenta que não esteja no catálogo de executores: se o modelo
 * enxergasse `funil` no schema sem existir quem o executasse, toda chamada
 * viraria `rejectedToolCalls` e o Oráculo responderia sem os números, sem erro
 * nenhum aparecer na tela. Manter a lista dividida entre dois arquivos é o que
 * deixa esse descompasso acontecer.
 */

import type { OracleScope } from "./scope.ts";
import { metricasTool, type ToolDb } from "./tools/metricas.ts";
import { funilTool } from "./tools/funil.ts";
import { rankingTool } from "./tools/ranking.ts";
import { perdasTool } from "./tools/perdas.ts";
import { leadsTool } from "./tools/leads.ts";
import { conversasTool } from "./tools/conversas.ts";
import { conversaDetalheTool } from "./tools/conversa-detalhe.ts";
import { proporAcaoTool } from "./tools/propor-acao.ts";
import { gargaloTool } from "./tools/gargalo.ts";
import { benchmarkTool } from "./tools/benchmark.ts";

export interface ToolSchema {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const PERIODO = {
  type: "integer",
  description: "Janela em dias (padrão 30, máximo 365).",
};

const LIMITE = {
  type: "integer",
  description: "Quantas linhas devolver (padrão 20, máximo 50).",
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "benchmark",
      description:
        "Compara a organização com o próprio passado e, quando há pelo menos cinco pares elegíveis, com mediana e faixa anônimas entre as operações ativas da base Torque. Lê snapshot semanal já materializado. Nunca chame isso de mercado, nunca estime valor ausente e explique `não tenho base suficiente para comparar` quando `external_benchmark.available` for falso. Exige escopo da organização inteira.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gargalo",
      description:
        "Diagnóstico determinístico do maior vazamento estimado de receita entre etapa, origem e produto, comparando quatro semanas fechadas à linha de base anterior de oito semanas. O resultado pode ser `none` ou `insufficient_evidence`; nesses casos, não invente um gargalo. Explique `evidence.reason`, `evidence.missing_dimensions` e `evidence.available_from` quando existirem.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "metricas",
      description:
        "Números do período: leads criados, vendas, perdas, receita líquida de estornos, ticket médio e conversão. O recorte de quem pode ver o quê já vem aplicado.",
      parameters: {
        type: "object",
        properties: { periodo_dias: PERIODO },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propor_acao",
      description:
        "Cria uma proposta confirmável, sem alterar o CRM. A contagem é previsão. Critério é reavaliado no clique. Ações: mover etapa, criar follow-up, atribuir responsável ou adicionar tag.",
      parameters: {
        type: "object",
        required: ["acao", "criterio"],
        properties: {
          acao: {
            type: "string",
            enum: ["mover_etapa", "criar_follow_up", "atribuir_responsavel", "adicionar_tag"],
          },
          criterio: { type: "string", enum: ["leads_parados", "leads_sem_contato"] },
          dias: {
            type: "integer",
            description: "Idade mínima do card parado. Padrão 14; máximo 365.",
          },
          pipeline: {
            type: "string",
            description: "Nome ou slug do funil, obrigatório para mover etapa.",
          },
          etapa_destino: { type: "string", description: "Nome ou chave da etapa destino." },
          titulo: { type: "string", description: "Título do follow-up." },
          prazo_dias: { type: "integer", description: "Prazo do follow-up em dias." },
          responsavel: { type: "string", description: "Nome exato da pessoa responsável." },
          tag: { type: "string", description: "Nome exato da tag existente." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "conversas",
      description:
        "Visão agregada das conversas comerciais no período: cobertura dos resumos, sentimento, temperatura, objeções e conversas recentes. Cada item traz lead_id e instance_id para abrir o detalhe dentro do mesmo escopo.",
      parameters: {
        type: "object",
        properties: { periodo_dias: PERIODO, limite: LIMITE },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "conversa_detalhe",
      description:
        "Transcrição de uma conversa já localizada por `conversas`. Exige lead_id e instance_id. Conversa fora do escopo volta vazia.",
      parameters: {
        type: "object",
        required: ["lead_id", "instance_id"],
        properties: {
          lead_id: { type: "string", format: "uuid" },
          instance_id: { type: "string", format: "uuid" },
          limite: {
            type: "integer",
            description: "Mensagens mais recentes (padrão 100, máximo 200).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "funil",
      description:
        "Conversão etapa a etapa, para achar onde a operação trava: quantos negócios estão parados em cada etapa de cada funil, na ordem em que as etapas acontecem.",
      parameters: {
        type: "object",
        properties: { periodo_dias: PERIODO },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ranking",
      description:
        "Desempenho por pessoa no período: vendas, receita e perdas. Só existe para quem alcança a organização inteira — se você não alcança, a ferramenta recusa e você deve dizer isso em vez de estimar.",
      parameters: {
        type: "object",
        properties: { periodo_dias: PERIODO, limite: LIMITE },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perdas",
      description:
        "Negócio perdido no período: quantos, quanto valor e por quem. ATENÇÃO: o motivo da perda NÃO é registrado nesta base — a resposta traz `motivo_disponivel: false`. Quando isso vier, diga que o porquê não está registrado em vez de supor um motivo.",
      parameters: {
        type: "object",
        properties: { periodo_dias: PERIODO, limite: LIMITE },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leads",
      description:
        "Lista recortada de leads. `parados`: sem atualização há N dias, ainda em funil aberto. `sem_contato`: nunca saíram da etapa em que entraram.",
      parameters: {
        type: "object",
        properties: {
          recorte: {
            type: "string",
            enum: ["parados", "sem_contato"],
            description: "Qual lista. Padrão: parados.",
          },
          dias: {
            type: "integer",
            description: "Quantos dias de silêncio (padrão 14, máximo 365).",
          },
          limite: LIMITE,
        },
      },
    },
  },
];

export interface FerramentaDoLaco {
  name: string;
  execute(args: Record<string, unknown>, scope: OracleScope): Promise<unknown>;
}

/** Os executores, na mesma ordem em que o catálogo os anuncia. */
export function criarFerramentas(db: ToolDb): FerramentaDoLaco[] {
  const deps = { db };
  return [
    metricasTool,
    funilTool,
    rankingTool,
    perdasTool,
    leadsTool,
    conversasTool,
    conversaDetalheTool,
    proporAcaoTool,
    gargaloTool,
    benchmarkTool,
  ].map(
    (t) => ({
      name: t.name,
      execute: (args: Record<string, unknown>, scope: OracleScope) => t.execute(args, scope, deps),
    }),
  );
}
