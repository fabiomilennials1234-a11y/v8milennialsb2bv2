import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildTurnContext } from "./memory.ts";

Deno.test("buildTurnContext — a pergunta de acompanhamento chega ao modelo com o turno anterior", () => {
  const ctx = buildTurnContext({
    history: [
      { role: "user", content: "qual vendedor está com mais dificuldade?" },
      { role: "assistant", content: "A conversão da Ana caiu de 22% para 14%." },
    ],
    summary: null,
    keepLastTurns: 6,
  });

  assertEquals(ctx.messages.map((m) => m.content), [
    "qual vendedor está com mais dificuldade?",
    "A conversão da Ana caiu de 22% para 14%.",
  ]);
});

Deno.test("buildTurnContext — janela cheia corta os turnos antigos e entrega o que precisa virar resumo", () => {
  const history = [
    { role: "user" as const, content: "t1" },
    { role: "assistant" as const, content: "r1" },
    { role: "user" as const, content: "t2" },
    { role: "assistant" as const, content: "r2" },
    { role: "user" as const, content: "t3" },
  ];

  const ctx = buildTurnContext({ history, summary: "Conversa anterior sobre funil.", keepLastTurns: 2 });

  assertEquals(ctx.messages.map((m) => m.content), ["r2", "t3"]);
  assertEquals(ctx.evicted.map((m) => m.content), ["t1", "r1", "t2"]);
  assertEquals(ctx.summary, "Conversa anterior sobre funil.");
});
