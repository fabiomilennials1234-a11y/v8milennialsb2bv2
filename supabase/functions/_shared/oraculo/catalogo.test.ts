import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { TOOL_SCHEMAS, criarFerramentas } from "./catalogo.ts";
import type { ToolDb } from "./tools/metricas.ts";

const dbFalso: ToolDb = {
  rpc: () => Promise.resolve({ data: null, error: null }),
};

Deno.test("catálogo — todo nome anunciado ao modelo tem executor, e vice-versa", () => {
  // O laço rejeita em silêncio ferramenta fora do catálogo de executores. Se o
  // modelo enxerga `funil` no schema e não existe quem execute, toda chamada
  // vira `rejectedToolCalls` e o Oráculo responde sem os números — sem erro
  // nenhum aparecer.
  const anunciadas = TOOL_SCHEMAS.map((s) => s.function.name).sort();
  const executaveis = criarFerramentas(dbFalso).map((t) => t.name).sort();

  assertEquals(anunciadas, executaveis);
});

Deno.test("catálogo — as cinco ferramentas da Onda 2 estão no ar", () => {
  const nomes = TOOL_SCHEMAS.map((s) => s.function.name).sort();
  assertEquals(nomes, ["funil", "leads", "metricas", "perdas", "ranking"]);
});
