import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { restApiCategory } from "@/lib/api-docs/rest-api-endpoints";

/**
 * A tela de documentação DENTRO do produto descreve as mesmas rotas que a
 * especificação pública.
 *
 * Existem três lugares descrevendo a API: o roteador (a verdade), a
 * `openapi.json` (o contrato para máquina) e esta tela (o que o cliente lê).
 * Roteador e openapi já têm guarda de paridade, do lado do Deno. Faltava a
 * terceira — e foi ela que ficou para trás: quando as rotas de Negócio entraram,
 * a tela seguiu mostrando 12 endpoints e não mencionava Negócio em lugar nenhum.
 *
 * Doc que descreve metade é pior que doc nenhuma, porque quem lê acredita.
 */

const SPEC = resolve(__dirname, "../../public/api/openapi.json");

function caminhosDaEspecificacao(): Set<string> {
  const spec = JSON.parse(readFileSync(SPEC, "utf8"));
  const out = new Set<string>();
  for (const [caminho, ops] of Object.entries(spec.paths ?? {})) {
    for (const metodo of Object.keys(ops as Record<string, unknown>)) {
      if (["get", "post", "patch", "put", "delete"].includes(metodo)) {
        out.add(`${metodo.toUpperCase()} ${caminho}`);
      }
    }
  }
  return out;
}

function caminhosDaTela(): Set<string> {
  return new Set(restApiCategory.endpoints.map((e) => `${e.method} ${e.path}`));
}

describe("documentação da API — as três descrições concordam", () => {
  it("toda rota da especificação aparece na tela do produto", () => {
    const faltando = [...caminhosDaEspecificacao()].filter((r) => !caminhosDaTela().has(r)).sort();
    expect(faltando).toEqual([]);
  });

  it("a tela não anuncia rota que a especificação não tem", () => {
    const sobrando = [...caminhosDaTela()].filter((r) => !caminhosDaEspecificacao().has(r)).sort();
    expect(sobrando).toEqual([]);
  });

  // A rota que move um LEAD para uma etapa contradiz a decisão 1 do ADR-0023:
  // um Lead nunca tem etapa. Ela segue viva para não quebrar quem integrou, mas
  // o cliente precisa ver que está depreciada — senão continua sendo escolhida
  // por quem está começando agora.
  it("a rota de mover LEAD aparece marcada como depreciada", () => {
    const stage = restApiCategory.endpoints.find((e) => e.path === "/api/v1/leads/{id}/stage");
    expect(stage).toBeDefined();
    expect(stage?.deprecated).toBe(true);
    expect(stage?.deprecation_notice ?? "").toMatch(/deals\/\{id\}\/move/);
  });

  // A armadilha de vocabulário: no Kommo, "lead" é o card que anda no funil —
  // o papel que aqui é do Negócio. Quem modela por analogia erra tudo, e
  // descobre depois de escrever a integração.
  it("a descrição da categoria avisa sobre o vocabulário do Kommo", () => {
    expect(restApiCategory.description).toMatch(/kommo/i);
    expect(restApiCategory.description).toMatch(/neg[óo]cio/i);
  });
});
