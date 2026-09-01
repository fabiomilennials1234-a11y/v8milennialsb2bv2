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
  return [metricasTool, funilTool, rankingTool, perdasTool, leadsTool].map(
    (t) => ({
      name: t.name,
      execute: (args: Record<string, unknown>, scope: OracleScope) =>
        t.execute(args, scope, deps),
    }),
  );
}
