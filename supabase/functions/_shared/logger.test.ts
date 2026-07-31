/**
 * Testes de `logRuntime` — o canal de observabilidade compartilhado pelas 78+
 * edge functions.
 *
 * Os dois casos aqui cobrem defeitos que só aparecem quando algo já está
 * errado, que é justamente quando ninguém está olhando:
 *
 *   1. Falha de ESCRITA. `supabase-js` devolve `{ error }` em vez de lançar,
 *      então um `try/catch` sozinho não vê nada. Com o banco fora, `logRuntime`
 *      não escrevia e não avisava.
 *   2. TEMPORIZADOR vazado. O auth-js arma um `setInterval` de 30 s por cliente
 *      criado (`_startAutoRefresh`). `logRuntime` cria um cliente POR CHAMADA,
 *      em isolate de vida longa. Um cliente `service_role` não tem sessão de
 *      usuário para renovar — o temporizador não serve para nada.
 *
 * Nenhum dos dois toca a rede: `globalThis.fetch` é substituído por um dublê
 * que devolve a resposta de erro do PostgREST.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { logRuntime } from "./logger.ts";

const DB_ERROR_MESSAGE = "permission denied for table runtime_logs";

/** Resposta que o PostgREST devolve quando a escrita é recusada. */
function postgrestDenied(): Response {
  return new Response(
    JSON.stringify({
      code: "42501",
      details: null,
      hint: null,
      message: DB_ERROR_MESSAGE,
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

interface Harness {
  /** Tudo que foi para console.warn/console.error durante a chamada. */
  consoleOutput: string;
  /** Delays dos `setInterval` armados durante a chamada. */
  intervalsArmed: number[];
  restore: () => void;
}

function installHarness(): Harness {
  const realFetch = globalThis.fetch;
  const realSetInterval = globalThis.setInterval;
  const realWarn = console.warn;
  const realError = console.error;

  const lines: string[] = [];
  const armedIds: number[] = [];
  const armedDelays: number[] = [];

  Deno.env.set("SUPABASE_URL", "http://logger-test.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-de-teste");

  globalThis.fetch = (() => Promise.resolve(postgrestDenied())) as typeof fetch;

  globalThis.setInterval = ((
    // deno-lint-ignore no-explicit-any
    ...args: any[]
  ) => {
    // deno-lint-ignore no-explicit-any
    const id = (realSetInterval as any)(...args);
    armedIds.push(id);
    armedDelays.push(typeof args[1] === "number" ? args[1] : -1);
    return id;
  }) as typeof setInterval;

  // deno-lint-ignore no-explicit-any
  const capture = (...args: any[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : Deno.inspect(a))).join(" "));
  };
  console.warn = capture;
  console.error = capture;

  const harness: Harness = {
    get consoleOutput() {
      return lines.join("\n");
    },
    get intervalsArmed() {
      return armedDelays;
    },
    restore() {
      // Desarma o que tiver vazado ANTES de devolver os globais: assim o modo
      // vermelho falha na asserção (mensagem precisa) em vez de virar um
      // "leaking async ops" genérico do sanitizador.
      for (const id of armedIds) clearInterval(id);
      globalThis.fetch = realFetch;
      globalThis.setInterval = realSetInterval;
      console.warn = realWarn;
      console.error = realError;
    },
  };
  return harness;
}

Deno.test("logRuntime — falha de escrita do banco vira sinal, não silêncio", async () => {
  const h = installHarness();
  try {
    await logRuntime({
      module: "general",
      action: "probe_insert_failure",
      status: "success",
      organizationId: "6030520a-2ca7-477d-be89-55758e2cd808",
    });
  } finally {
    h.restore();
  }

  // `supabase-js` resolve com `{ error }` — nada é lançado. Se o retorno do
  // insert for descartado, esta string não aparece em lugar nenhum e o banco
  // fora do ar fica invisível.
  assertStringIncludes(
    h.consoleOutput,
    DB_ERROR_MESSAGE,
    "a recusa do banco tem de sair no console — é o único canal que sobra quando runtime_logs é justamente o que falhou",
  );
});

Deno.test("logRuntime — não deixa temporizador armado atrás de si", async () => {
  const h = installHarness();
  try {
    await logRuntime({
      module: "general",
      action: "probe_timer_leak",
      status: "success",
    });
    // O auth-js arma o ticker dentro do `_initialize()`, que resolve numa
    // macrotarefa posterior ao insert. Um tique de folga torna a medição
    // determinística em vez de dependente da ordem das promises.
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    h.restore();
  }

  assertEquals(
    h.intervalsArmed,
    [],
    `logRuntime roda por requisição em isolate de vida longa: cada setInterval sobrevivente ` +
      `acumula para sempre. Delays armados: ${JSON.stringify(h.intervalsArmed)}`,
  );
});

Deno.test("logRuntime — nunca lança, mesmo com o banco recusando", async () => {
  const h = installHarness();
  try {
    // Sem `assertRejects`: o contrato é o oposto — a chamada tem de resolver.
    await logRuntime({ module: "voip", action: "probe_never_throws", status: "error" });
  } finally {
    h.restore();
  }
});
