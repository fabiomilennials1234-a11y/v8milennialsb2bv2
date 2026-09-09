import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { runTurn, type Llm, type OracleTool } from "./loop.ts";
import type { OracleScope } from "./scope.ts";

const scope: OracleScope = { kind: "organization", organizationId: "org-1", teamMemberId: "tm-gestor" };

/** LLM roteirizado: devolve uma resposta por chamada, na ordem. */
function scriptedLlm(script: Array<{ toolCalls?: { name: string; arguments: Record<string, unknown> }[]; text?: string }>): Llm {
  let i = 0;
  return {
    complete: () => {
      const step = script[Math.min(i++, script.length - 1)];
      return Promise.resolve({ model: "test-model", inputTokens: 100, outputTokens: 20, ...step });
    },
  };
}

const metricas: OracleTool = {
  name: "metricas",
  execute: () => Promise.resolve({ conversao: 0.14 }),
};

Deno.test("runTurn — o modelo consulta a ferramenta e a resposta declara a procedência", async () => {
  const llm = scriptedLlm([
    { toolCalls: [{ name: "metricas", arguments: { periodo: "30d" } }] },
    { text: "A conversão do período é 14%." },
  ]);

  const result = await runTurn({
    llm,
    tools: [metricas],
    scope,
    messages: [{ role: "user", content: "como está a conversão?" }],
  });

  assertEquals(result.text, "A conversão do período é 14%.");
  assertEquals(result.toolsUsed, ["metricas"]);
});

Deno.test("runTurn — teto de 6 ferramentas por turno: para e responde com o que tem", async () => {
  const llm = scriptedLlm([{ toolCalls: [{ name: "metricas", arguments: {} }] }]); // nunca conclui
  let chamadas = 0;
  const contador: OracleTool = {
    name: "metricas",
    execute: () => { chamadas++; return Promise.resolve({}); },
  };

  const result = await runTurn({
    llm,
    tools: [contador],
    scope,
    messages: [{ role: "user", content: "e agora?" }],
    maxToolCalls: 6,
  });

  assertEquals(chamadas, 6);
  assertEquals(result.hitToolCeiling, true);
  assertEquals(result.toolsUsed.length, 6);
});

Deno.test("runTurn — cada turno registra modelo, tokens somados, ferramentas e latência", async () => {
  const llm = scriptedLlm([
    { toolCalls: [{ name: "metricas", arguments: {} }] },
    { text: "pronto" },
  ]);
  let clock = 1000;

  const result = await runTurn({
    llm,
    tools: [metricas],
    scope,
    messages: [{ role: "user", content: "?" }],
    now: () => (clock += 250),
  });

  assertEquals(result.telemetry.model, "test-model");
  assertEquals(result.telemetry.inputTokens, 200);
  assertEquals(result.telemetry.outputTokens, 40);
  assertEquals(result.telemetry.toolCalls, 1);
  assertEquals(result.telemetry.latencyMs, 250);
});

Deno.test("runTurn — ferramenta fora do catálogo não executa e a tentativa fica registrada, não engolida", async () => {
  const llm = scriptedLlm([
    { toolCalls: [{ name: "mover_card", arguments: { lead_id: "l-1" } }] },
    { text: "não consigo fazer isso." },
  ]);

  const result = await runTurn({
    llm,
    tools: [metricas],
    scope,
    messages: [{ role: "user", content: "move o lead pra ganho" }],
  });

  assertEquals(result.toolsUsed, []);
  assertEquals(result.rejectedToolCalls, ["mover_card"]);
});
