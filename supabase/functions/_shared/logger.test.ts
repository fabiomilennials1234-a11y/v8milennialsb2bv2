/**
 * Testes de `logRuntime` — o canal de observabilidade compartilhado por 173 das
 * 175 edge functions.
 *
 * Defeitos cobertos aqui só aparecem quando algo já está errado, que é
 * justamente quando ninguém está olhando:
 *
 *   1. Falha de ESCRITA. `supabase-js` devolve `{ error }` em vez de lançar,
 *      então um `try/catch` sozinho não vê nada. Com o banco fora, `logRuntime`
 *      não escrevia e não avisava.
 *   2. TEMPORIZADOR vazado. O auth-js arma um `setInterval` de 30 s por cliente
 *      criado (`_startAutoRefresh`). Um cliente `service_role` não tem sessão de
 *      usuário para renovar — o temporizador não serve para nada.
 *
 * E o contrato do LOTE (incidente OOM de 2026-10-05: 19.231 POST/h em
 * `runtime_logs` no pico, 83k linhas/dia de sucesso que ninguém lê):
 *
 *   3. N linhas viram UM POST.
 *   4. `status:'error'` e trilha do gestor (`actorType`) nunca esperam a janela.
 *   5. Sucesso de alto volume é AMOSTRADO; o que fica de fora vai para o
 *      console (function_logs) REDIGIDO, nunca cru.
 *   6. Falha do lote = UM relato + as linhas (redigidas) no console.
 *
 * Nenhum toca a rede: `globalThis.fetch` é substituído por um dublê.
 * `await logRuntime()` deixou de significar "persistido" — significa
 * "enfileirado". `await flushRuntimeLogs()` é o "persistido".
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { flushRuntimeLogs, logRuntime, SUCCESS_SAMPLE_RATE } from "./logger.ts";

const DB_ERROR_MESSAGE = "permission denied for table runtime_logs";

/** Resposta que o PostgREST devolve quando a escrita é recusada. */
function postgrestDenied(): Response {
  return new Response(
    JSON.stringify({ code: "42501", details: null, hint: null, message: DB_ERROR_MESSAGE }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

function postgrestCreated(): Response {
  return new Response(null, { status: 201 });
}

type Row = Record<string, unknown>;

interface Harness {
  /** Tudo que foi para console.warn/console.error. */
  consoleOutput: string;
  /** Linhas `console.error` — `logError` escreve uma por relato. */
  errorLines: string[];
  /** Linhas `console.info` — o canal de rebaixamento. */
  infoLines: string[];
  /** Cada POST a runtime_logs, com as linhas do corpo. */
  posts: Row[][];
  /** Delays dos `setInterval` armados durante a chamada. */
  intervalsArmed: number[];
  /** Promessas entregues a `EdgeRuntime.waitUntil` (quando instalado). */
  waitUntil: Promise<unknown>[];
  restore: () => void;
}

interface HarnessOptions {
  respond?: (rows: Row[]) => Response;
  /** Simula o Supabase Edge Runtime (janela de 250 ms + waitUntil). */
  edgeRuntime?: boolean;
  random?: () => number;
}

function installHarness(opts: HarnessOptions = {}): Harness {
  const realFetch = globalThis.fetch;
  const realSetInterval = globalThis.setInterval;
  const realWarn = console.warn;
  const realError = console.error;
  const realInfo = console.info;
  const realRandom = Math.random;
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const hadEdge = "EdgeRuntime" in g;
  const realEdge = g.EdgeRuntime;

  const warnLines: string[] = [];
  const errorLines: string[] = [];
  const infoLines: string[] = [];
  const posts: Row[][] = [];
  const armedIds: number[] = [];
  const armedDelays: number[] = [];
  const waitUntil: Promise<unknown>[] = [];

  Deno.env.set("SUPABASE_URL", "http://logger-test.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-de-teste");

  const respond = opts.respond ?? (() => postgrestDenied());
  globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes("runtime_logs")) return Promise.resolve(postgrestCreated());
    const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "null");
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Row[];
    posts.push(rows);
    return Promise.resolve(respond(rows));
  }) as typeof fetch;

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
  const fmt = (args: any[]) =>
    args.map((a) => (typeof a === "string" ? a : Deno.inspect(a))).join(" ");
  // deno-lint-ignore no-explicit-any
  console.warn = (...args: any[]) => warnLines.push(fmt(args));
  // deno-lint-ignore no-explicit-any
  console.error = (...args: any[]) => errorLines.push(fmt(args));
  // deno-lint-ignore no-explicit-any
  console.info = (...args: any[]) => infoLines.push(fmt(args));

  if (opts.random) Math.random = opts.random;
  if (opts.edgeRuntime) {
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waitUntil.push(p) };
  }

  return {
    get consoleOutput() {
      return [...warnLines, ...errorLines].join("\n");
    },
    errorLines,
    infoLines,
    posts,
    get intervalsArmed() {
      return armedDelays;
    },
    waitUntil,
    restore() {
      // Desarma o que tiver vazado ANTES de devolver os globais: assim o modo
      // vermelho falha na asserção (mensagem precisa) em vez de virar um
      // "leaking async ops" genérico do sanitizador.
      for (const id of armedIds) clearInterval(id);
      globalThis.fetch = realFetch;
      globalThis.setInterval = realSetInterval;
      console.warn = realWarn;
      console.error = realError;
      console.info = realInfo;
      Math.random = realRandom;
      if (hadEdge) g.EdgeRuntime = realEdge;
      else delete g.EdgeRuntime;
    },
  };
}

/** Executa `fn` com o harness e SEMPRE esvazia a fila antes de restaurar. */
async function withHarness(opts: HarnessOptions, fn: (h: Harness) => Promise<void>) {
  const h = installHarness(opts);
  try {
    await fn(h);
  } finally {
    await flushRuntimeLogs();
    h.restore();
  }
  return h;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Contratos herdados (adaptados: await flush = persistido) ────────────────

Deno.test("logRuntime — falha de escrita do banco vira sinal, não silêncio", async () => {
  const h = await withHarness({}, async () => {
    await logRuntime({
      module: "general",
      action: "probe_insert_failure",
      status: "success",
      organizationId: "6030520a-2ca7-477d-be89-55758e2cd808",
    });
    await flushRuntimeLogs();
  });

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
  const h = await withHarness({}, async () => {
    await logRuntime({ module: "general", action: "probe_timer_leak", status: "success" });
    await flushRuntimeLogs();
    // O auth-js arma o ticker dentro do `_initialize()`, que resolve numa
    // macrotarefa posterior ao insert. Um tique de folga torna a medição
    // determinística em vez de dependente da ordem das promises.
    await sleep(0);
  });

  assertEquals(
    h.intervalsArmed,
    [],
    `logRuntime roda por requisição em isolate de vida longa: cada setInterval sobrevivente ` +
      `acumula para sempre. Delays armados: ${JSON.stringify(h.intervalsArmed)}`,
  );
});

Deno.test("logRuntime — nunca lança, mesmo com o banco recusando", async () => {
  await withHarness({}, async () => {
    // Sem `assertRejects`: o contrato é o oposto — a chamada tem de resolver.
    await logRuntime({ module: "voip", action: "probe_never_throws", status: "error" });
    await flushRuntimeLogs();
  });
});

// ─── Lote ────────────────────────────────────────────────────────────────────

Deno.test("lote — N linhas enfileiradas saem num único POST", async () => {
  const h = await withHarness({ respond: () => postgrestCreated() }, async (h) => {
    for (let i = 0; i < 5; i++) {
      await logRuntime({ module: "general", action: `probe_lote_${i}`, status: "success" });
    }
    assertEquals(h.posts.length, 0, "await logRuntime = enfileirado, não persistido");
    await flushRuntimeLogs();
  });

  assertEquals(h.posts.length, 1, "um POST por flush");
  assertEquals(h.posts[0].map((r) => r.action), [0, 1, 2, 3, 4].map((i) => `probe_lote_${i}`));
});

Deno.test("lote — fila cheia (100) dispara o flush sem esperar a janela", async () => {
  await withHarness({ respond: () => postgrestCreated(), edgeRuntime: true }, async (h) => {
    for (let i = 0; i < 100; i++) {
      await logRuntime({ module: "general", action: "probe_cheia", status: "success" });
    }
    await Promise.all(h.waitUntil);
    assertEquals(h.posts.length, 1);
    assertEquals(h.posts[0].length, 100);
  });
});

Deno.test("lote — no edge runtime a janela de 250 ms fica registrada em waitUntil", async () => {
  await withHarness({ respond: () => postgrestCreated(), edgeRuntime: true }, async (h) => {
    await logRuntime({ module: "general", action: "probe_janela", status: "success" });
    assertEquals(h.waitUntil.length, 1, "o isolate não pode morrer com a linha na fila");
    await sleep(20);
    assertEquals(h.posts.length, 0, "dentro da janela nada sai");
    await Promise.all(h.waitUntil);
    assertEquals(h.posts.length, 1, "a promessa entregue ao waitUntil cobre o flush da janela");
  });
});

Deno.test("lote — status:'error' esvazia a fila na hora, levando quem estava esperando", async () => {
  await withHarness({ respond: () => postgrestCreated(), edgeRuntime: true }, async (h) => {
    await logRuntime({ module: "general", action: "probe_antes", status: "success" });
    const t0 = performance.now();
    await logRuntime({ module: "general", action: "probe_erro", status: "error" });
    // Espera só o flush imediato (a última promessa registrada), bem antes dos 250 ms.
    await h.waitUntil[h.waitUntil.length - 1];
    assertEquals(h.posts.length, 1);
    assert(performance.now() - t0 < 150, "a linha de erro esperou a janela");
    assertEquals(h.posts[0].map((r) => r.action), ["probe_antes", "probe_erro"]);
    await sleep(300);
    assertEquals(h.posts.length, 1, "a janela foi desarmada: nada de POST vazio depois");
  });
});

Deno.test("lote — trilha do gestor (actorType) nunca espera a janela nem é amostrada", async () => {
  await withHarness(
    { respond: () => postgrestCreated(), edgeRuntime: true, random: () => 0.999 },
    async (h) => {
      const t0 = performance.now();
      await logRuntime({
        module: "webhook",
        action: "uazapi_process",
        status: "success",
        actorType: "gestor",
        gestorId: "6030520a-2ca7-477d-be89-55758e2cd808",
      });
      await h.waitUntil[h.waitUntil.length - 1];
      assertEquals(h.posts.length, 1);
      assert(performance.now() - t0 < 150, "a trilha do gestor esperou a janela");
      assertEquals(h.posts[0][0].actor_type, "gestor");
      assertEquals(h.infoLines.length, 0);
    },
  );
});

// ─── Amostragem e rebaixamento ───────────────────────────────────────────────

Deno.test("amostragem — tabela cobre as 7 actions do plano e nada abaixo de 1%", () => {
  assertEquals(SUCCESS_SAMPLE_RATE["webhook:uazapi_process"], 0.01);
  assertEquals(SUCCESS_SAMPLE_RATE["webhook:uazapi_resolved_by_token_fallback"], 0.01);
  assertEquals(SUCCESS_SAMPLE_RATE["webhook:uazapi_group_message_skipped"], 0.01);
  assertEquals(SUCCESS_SAMPLE_RATE["webhook:uazapi_agent_message_dispatched"], 0.05);
  assertEquals(SUCCESS_SAMPLE_RATE["webhook:uazapi_receipt_unmatched"], 0.1);
  assertEquals(SUCCESS_SAMPLE_RATE["workflow:process_batch"], 0.1);
  assertEquals(SUCCESS_SAMPLE_RATE["whatsapp:run"], 0.1);
  for (const r of Object.values(SUCCESS_SAMPLE_RATE)) assert(r > 0 && r <= 1);
});

Deno.test("amostragem — sorteada DENTRO vai ao banco com _sample_rate", async () => {
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.001 }, async () => {
    await logRuntime({
      module: "webhook",
      action: "uazapi_process",
      status: "success",
      payloadSnapshot: { instance_id: "abc" },
    });
  });
  assertEquals(h.posts.length, 1);
  const snap = h.posts[0][0].payload_snapshot as Row;
  assertEquals(snap._sample_rate, 0.01);
  assertEquals(snap.instance_id, "abc");
  assertEquals(h.infoLines.length, 0);
});

Deno.test("amostragem — sorteada FORA não vai ao banco: vira console.info rt:1", async () => {
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.5 }, async () => {
    await logRuntime({ module: "webhook", action: "uazapi_receipt_unmatched", status: "skipped" });
  });
  assertEquals(h.posts.length, 0);
  assertEquals(h.infoLines.length, 1);
  const linha = JSON.parse(h.infoLines[0]);
  assertEquals(linha.rt, 1);
  assertEquals(linha.module, "webhook");
  assertEquals(linha.action, "uazapi_receipt_unmatched");
  assertEquals(linha.status, "skipped");
  assertEquals(linha.payload_snapshot._sample_rate, 0.1);
});

Deno.test("amostragem — erro NUNCA é amostrado, nem na action de alto volume", async () => {
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.999 }, async () => {
    await logRuntime({ module: "webhook", action: "uazapi_process", status: "error" });
  });
  assertEquals(h.posts.length, 1);
  assertEquals((h.posts[0][0].payload_snapshot ?? null), null, "linha de erro não ganha _sample_rate");
  assertEquals(h.infoLines.length, 0);
});

Deno.test("amostragem — action fora da tabela tem taxa 1 e não ganha _sample_rate", async () => {
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.999 }, async () => {
    await logRuntime({ module: "webhook", action: "outra_action", status: "success" });
  });
  assertEquals(h.posts.length, 1);
  assertEquals(h.posts[0][0].payload_snapshot, null);
});

Deno.test("rebaixamento — a linha do console é a REDIGIDA: telefone mascarado, token REDACTED", async () => {
  const telefone = "5511987654321";
  const token = "tok_super_secreto_123";
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.5 }, async () => {
    await logRuntime({
      module: "webhook",
      action: "uazapi_resolved_by_token_fallback",
      status: "success",
      payloadSnapshot: { phone: telefone, uazapi_token: token, nested: { remote_jid: `${telefone}@s.whatsapp.net` } },
    });
  });
  assertEquals(h.posts.length, 0);
  assertEquals(h.infoLines.length, 1);
  const cru = h.infoLines[0];
  assert(!cru.includes(telefone), `telefone cru vazou para o console: ${cru}`);
  assert(!cru.includes(token), `token cru vazou para o console: ${cru}`);
  const linha = JSON.parse(cru);
  assertEquals(linha.payload_snapshot.phone, "5511*****4321");
  assertEquals(linha.payload_snapshot.uazapi_token, "***REDACTED***");
  assertEquals(linha.payload_snapshot.nested.remote_jid, "5511*****4321@s.whatsapp.net");
});

// ─── Falha do lote ───────────────────────────────────────────────────────────

Deno.test("falha do lote — UM relato e as linhas (redigidas) no console", async () => {
  const telefone = "5511987654321";
  const h = await withHarness({}, async () => {
    for (let i = 0; i < 3; i++) {
      await logRuntime({
        module: "general",
        action: `probe_falha_${i}`,
        status: "success",
        payloadSnapshot: { phone: telefone },
      });
    }
  });
  assertEquals(h.posts.length, 1, "recusa de permissão não é retentada linha a linha");
  const relatos = h.errorLines.filter((l) => l.includes('"function_name":"logRuntime"'));
  assertEquals(relatos.length, 1, `um relato por lote, não por linha: ${relatos.length}`);
  assertStringIncludes(relatos[0], '"batch_size":3');
  for (let i = 0; i < 3; i++) assertStringIncludes(h.consoleOutput, `probe_falha_${i}`);
  assert(!h.consoleOutput.includes(telefone), "linha devolvida ao console tem de sair redigida");
});

Deno.test("falha do lote — linha envenenada (22P02) não derruba as vizinhas", async () => {
  const VENENO = "nao-e-uuid";
  const respond = (rows: Row[]) =>
    rows.some((r) => r.entity_id === VENENO)
      ? new Response(
        JSON.stringify({ code: "22P02", details: null, hint: null, message: "invalid input syntax for type uuid" }),
        { status: 400, headers: { "content-type": "application/json" } },
      )
      : postgrestCreated();

  const h = await withHarness({ respond }, async () => {
    await logRuntime({ module: "general", action: "probe_boa_1", status: "success" });
    await logRuntime({ module: "general", action: "probe_ruim", status: "success", entityId: VENENO });
    await logRuntime({ module: "general", action: "probe_boa_2", status: "success" });
  });

  const gravadas = h.posts.filter((p) => p.length === 1 && p[0].entity_id !== VENENO).map((p) => p[0].action);
  assertEquals(gravadas.sort(), ["probe_boa_1", "probe_boa_2"]);
  const relatos = h.errorLines.filter((l) => l.includes('"function_name":"logRuntime"'));
  assertEquals(relatos.length, 1);
  assertStringIncludes(h.consoleOutput, "probe_ruim");
});

// ─── O console NUNCA recebe reasoning nem error_message crus ─────────────────

const REASONING_PII = "lead disse: meu telefone 11999887766, mora na Rua das Flores 42";
const ERRO_COM_TOKEN = `Bearer sk-live-abcdef123 ${"x".repeat(2000)}`;

Deno.test("falha do lote — reasoning sai como reasoning_len, error_message redigido e truncado", async () => {
  const h = await withHarness({}, async () => {
    await logRuntime({
      module: "copilot",
      action: "reasoning",
      status: "error",
      reasoning: REASONING_PII,
      errorMessage: ERRO_COM_TOKEN,
      organizationId: "6030520a-2ca7-477d-be89-55758e2cd808",
    });
  });
  assertEquals(h.posts.length, 1);
  assert(h.posts[0][0].reasoning === REASONING_PII, "o banco (master-only) continua recebendo o reasoning");
  const tudo = h.consoleOutput;
  assert(!tudo.includes("11999887766"), `reasoning cru vazou para o console: ${tudo.slice(0, 400)}`);
  assert(!tudo.includes("Rua das Flores"), "reasoning cru vazou para o console");
  assert(!tudo.includes("sk-live-abcdef123"), "token do error_message vazou para o console");
  const dump = h.consoleOutput.split("\n").find((l) => l.includes("perdido:"))!;
  const linhas = JSON.parse(dump.slice(dump.indexOf("perdido:") + "perdido:".length).trim());
  assertEquals(linhas[0].reasoning_len, REASONING_PII.length);
  assertEquals("reasoning" in linhas[0], false);
  assert(String(linhas[0].error_message).startsWith("Bearer ***REDACTED***"));
  assert(String(linhas[0].error_message).length < 600, "error_message truncado no console");
});

Deno.test("falha do lote — details 'Failing row contains' (linha inteira) não chega ao console", async () => {
  const respond = () =>
    new Response(
      JSON.stringify({
        code: "23502",
        details: `Failing row contains (abc, null, copilot, reasoning, error, null, null, ${REASONING_PII}).`,
        hint: null,
        message: 'null value in column "module" violates not-null constraint',
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  const h = await withHarness({ respond }, async () => {
    await logRuntime({ module: "copilot", action: "reasoning", status: "error", reasoning: REASONING_PII });
  });
  assert(!h.consoleOutput.includes("11999887766"), "details com a linha inteira vazou");
  assertStringIncludes(h.consoleOutput, "omitido: Failing row contains");
});

Deno.test("rebaixamento — reasoning também não sai cru na linha rt:1", async () => {
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.5 }, async () => {
    await logRuntime({ module: "webhook", action: "uazapi_process", status: "success", reasoning: REASONING_PII });
  });
  assertEquals(h.infoLines.length, 1);
  assert(!h.infoLines[0].includes("11999887766"));
  assertEquals(JSON.parse(h.infoLines[0]).reasoning_len, REASONING_PII.length);
});

Deno.test("falha do lote — lote com várias orgs não é atribuído à org da 1ª linha", async () => {
  const ORG_A = "6030520a-2ca7-477d-be89-55758e2cd808";
  const ORG_B = "7030520a-2ca7-477d-be89-55758e2cd808";
  const h = await withHarness({}, async () => {
    await logRuntime({ module: "general", action: "probe_a", status: "success", organizationId: ORG_A });
    await logRuntime({ module: "general", action: "probe_b", status: "success", organizationId: ORG_B });
  });
  const relato = JSON.parse(h.errorLines.find((l) => l.includes('"function_name":"logRuntime"'))!);
  assertEquals(relato.organization_id, undefined);
  assertEquals(relato.batch_size, 2);

  const h2 = await withHarness({}, async () => {
    await logRuntime({ module: "general", action: "probe_a1", status: "success", organizationId: ORG_A });
    await logRuntime({ module: "general", action: "probe_a2", status: "success", organizationId: ORG_A });
  });
  const relato2 = JSON.parse(h2.errorLines.find((l) => l.includes('"function_name":"logRuntime"'))!);
  assertEquals(relato2.organization_id, ORG_A, "lote de uma org só mantém a atribuição");
});

Deno.test("falha do lote — telefone/JID/e-mail/CPF em texto livre saem mascarados no console; o banco recebe o original", async () => {
  const msg = "falha ao enviar para 5511987654321@s.whatsapp.net (contato fulano.silva@exemplo.com.br, " +
    "grupo 120363000000000000@g.us, tel (11) 98765-4321, cpf 123.456.789-09, tentativa 3 de 2026)";
  const respond = () =>
    new Response(
      JSON.stringify({
        code: "22P02",
        details: "contato 5511987654321 sem uuid",
        hint: null,
        message: 'invalid input syntax for type uuid: "5511987654321"',
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  const h = await withHarness({ respond }, async () => {
    await logRuntime({ module: "whatsapp", action: "sendMedia", status: "error", errorMessage: msg });
  });
  assertEquals(h.posts[0][0].error_message, msg, "o banco recebe o texto original");
  const tudo = [h.consoleOutput, ...h.infoLines].join("\n");
  for (const cru of ["5511987654321", "fulano.silva", "exemplo.com.br", "120363000000000000", "98765-4321", "123.456.789-09"]) {
    assert(!tudo.includes(cru), `"${cru}" vazou cru para o console`);
  }
  // Mantém o que serve ao diagnóstico: prefixo/sufixo, sufixo do JID e número curto.
  assertStringIncludes(tudo, "5511*****4321@s.whatsapp.net");
  assertStringIncludes(tudo, "1203**********0000@g.us");
  assertStringIncludes(tudo, "tentativa 3 de 2026");
});

/** O `error_message` como chega ao console no dump de um lote perdido (banco 500). */
async function errorMessageNoConsole(msg: string): Promise<string> {
  const respond = () =>
    new Response(JSON.stringify({ code: "XX000", details: null, hint: null, message: "internal" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  const h = await withHarness({ respond }, async () => {
    await logRuntime({ module: "whatsapp", action: "sendText", status: "error", errorMessage: msg });
  });
  const dump = h.consoleOutput.split("\n").find((l) => l.includes("perdido:"))!;
  return JSON.parse(dump.slice(dump.indexOf("perdido:") + "perdido:".length).trim())[0].error_message;
}

Deno.test("máscara — CPF/CNPJ colado com DV válido mostra só os 2 últimos; telefone de 11 dígitos segue 4+4", async () => {
  assertEquals(await errorMessageNoConsole("cpf 12345678909 recusado"), "cpf *********09 recusado");
  assertEquals(await errorMessageNoConsole("cnpj 11222333000181 recusado"), "cnpj ************81 recusado");
  assertEquals(await errorMessageNoConsole("tel 11987654321 recusado"), "tel 1198***4321 recusado");
});

Deno.test("máscara — CNPJ formatado com barra vira uma sequência só (2 últimos)", async () => {
  assertEquals(await errorMessageNoConsole("cnpj 11.222.333/0001-81"), "cnpj **.***.***/****-81");
});

Deno.test("máscara — data ISO e uuid/hex ficam intactos; telefone/JID/CPF continuam mascarados", async () => {
  const intacto = "em 2026-10-05T15:55:30Z e 2026-10-05 15:55 conversa 550e8400-e29b-41d4-a716-0123456789ab " +
    "lead 12345678-1234-4abc-8def-0123456789ab hash a1b2c3d4e5f6012345678901";
  assertEquals(await errorMessageNoConsole(intacto), intacto);
  const misto = await errorMessageNoConsole(
    "uuid 550e8400-e29b-41d4-a716-0123456789ab para 5511987654321@s.whatsapp.net cpf 123.456.789-09",
  );
  assertEquals(
    misto,
    "uuid 550e8400-e29b-41d4-a716-0123456789ab para 5511*****4321@s.whatsapp.net cpf ***.***.***-09",
  );
});

Deno.test("rebaixamento — error_message de linha rt:1 também é mascarado", async () => {
  const h = await withHarness({ respond: () => postgrestCreated(), random: () => 0.5 }, async () => {
    await logRuntime({
      module: "webhook",
      action: "uazapi_process",
      status: "success",
      errorMessage: "aviso para fulano@x.com.br 5511987654321",
    });
  });
  assertEquals(h.infoLines.length, 1);
  assert(!h.infoLines[0].includes("5511987654321") && !h.infoLines[0].includes("fulano@"));
});

Deno.test("sem SUPABASE_URL — não enfileira, não arma nada", async () => {
  const h = installHarness({});
  Deno.env.delete("SUPABASE_URL");
  try {
    await logRuntime({ module: "general", action: "probe_sem_env", status: "error" });
    await flushRuntimeLogs();
  } finally {
    h.restore();
  }
  assertEquals(h.posts.length, 0);
});
