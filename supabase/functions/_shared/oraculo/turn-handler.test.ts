import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { handleTurn, type TurnDeps } from "./turn-handler.ts";
import type { OracleTool } from "./loop.ts";

const cors = { "access-control-allow-origin": "*" };

const ana = {
  userId: "u-ana", teamMemberId: "tm-ana", organizationId: "org-1",
  role: "member", isMaster: false, isAdmin: false,
};

function deps(over: Partial<TurnDeps> = {}, spy: { escopos: unknown[] } = { escopos: [] }): TurnDeps {
  const metricas: OracleTool = {
    name: "metricas",
    execute: (_a, scope) => { spy.escopos.push(scope); return Promise.resolve({ vendas: 1 }); },
  };
  return {
    auth: () => Promise.resolve(ana),
    perms: () => Promise.resolve({ viewOrgMetrics: false }),
    llm: {
      complete: (req) =>
        Promise.resolve(
          req.toolResults.length === 0
            ? { model: "m", inputTokens: 10, outputTokens: 2, toolCalls: [{ name: "metricas", arguments: {} }] }
            : { model: "m", inputTokens: 10, outputTokens: 2, text: "Você fechou 1 venda." },
        ),
    },
    tools: [metricas],
    store: {
      turnsToday: () => Promise.resolve(0),
      orgLimit: () => Promise.resolve(null),
      loadConversation: () => Promise.resolve({ id: "c-1", summary: null, history: [] }),
      saveTurn: () => Promise.resolve(),
    },
    ...over,
  };
}

function post(body: unknown) {
  return new Request("https://x/oraculo-turno", { method: "POST", body: JSON.stringify(body) });
}

Deno.test("handleTurn — o member pergunta sobre a organização e a ferramenta recebe o Escopo dele, não o pedido", async () => {
  const spy = { escopos: [] as unknown[] };
  const res = await handleTurn(post({ pergunta: "qual o ranking da equipe?", organization_id: "org-do-vizinho" }), deps({}, spy), cors);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.resposta, "Você fechou 1 venda.");
  assertEquals(body.procedencia, ["metricas"]);
  assertEquals(spy.escopos[0], { kind: "assigned", organizationId: "org-1", teamMemberId: "tm-ana" });
});

Deno.test("handleTurn — no teto diário recusa antes de gastar chamada ao modelo", async () => {
  let chamouModelo = false;
  const d = deps({
    store: { ...deps().store, turnsToday: () => Promise.resolve(25) },
    llm: { complete: () => { chamouModelo = true; return Promise.resolve({ model: "m", inputTokens: 0, outputTokens: 0, text: "" }); } },
  });

  const res = await handleTurn(post({ pergunta: "e aí?" }), d, cors);

  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "limite_diario");
  assertEquals(chamouModelo, false);
});

Deno.test("handleTurn — a pergunta de acompanhamento chega ao modelo com o histórico da conversa", async () => {
  const vistas: string[][] = [];
  const d = deps({
    llm: {
      complete: (req) => {
        vistas.push(req.messages.map((m) => m.content));
        return Promise.resolve({ model: "m", inputTokens: 1, outputTokens: 1, text: "ok" });
      },
    },
    store: {
      ...deps().store,
      loadConversation: () =>
        Promise.resolve({
          id: "c-1",
          summary: "Falamos do funil.",
          history: [
            { role: "user" as const, content: "onde estou perdendo?" },
            { role: "assistant" as const, content: "Na etapa de proposta." },
          ],
        }),
    },
  });

  await handleTurn(post({ pergunta: "e por quê?", conversa_id: "c-1" }), d, cors);

  assertEquals(vistas[0], ["onde estou perdendo?", "Na etapa de proposta.", "e por quê?"]);
});
