/**
 * QA comportamental de `logRuntime` em lote (incidente OOM 2026-10-05).
 * Escrito pelo QA da trilha; trazido para o repo como teste de regressão.
 * Cenário compartilhado em `logger.comportamento.cenario.ts`.
 *
 * Sequência real do whatsapp-webhook por evento:
 *   (uazapi_resolved_by_token_fallback saiu do evento típico com o #2231)
 *   handler.ts:962  uazapi_group_message_skipped       (~21%)
 *   handler.ts:922  uazapi_agent_message_dispatched    (~13%, `void`)
 *   message-update.ts:189 uazapi_receipt_unmatched     (~4,5%)
 *   handler.ts:1703 uazapi_process                     (todo evento)
 * Proporções = prod 24 h até 05/10 (48.258 / 9.826 / 6.071 / 2.142 / 47.048).
 * PRNG semeado: determinístico.
 */

import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  flushRuntimeLogs,
  logRuntime,
  redactSecrets,
} from "./logger.ts";
import { ORG, PAYLOAD, REASONING, CRUS, TOKEN, mulberry32, webhookEvent } from "./logger.comportamento.cenario.ts";

type Row = Record<string, unknown>;

interface H {
  posts: Row[][];
  info: string[];
  warn: string[];
  error: string[];
  waitUntil: Promise<unknown>[];
  readonly console: string;
  restore(): void;
}

function install(opts: {
  respond?: (rows: Row[]) => Response | Promise<Response>;
  edge?: boolean;
  random?: () => number;
  env?: boolean;
} = {}): H {
  const realFetch = globalThis.fetch;
  const realInfo = console.info, realWarn = console.warn, realError = console.error;
  const realRandom = Math.random;
  const g = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): unknown };
  };
  const hadEdge = "EdgeRuntime" in g, realEdge = g.EdgeRuntime;
  const h: H = {
    posts: [], info: [], warn: [], error: [], waitUntil: [],
    get console() {
      return [...this.info, ...this.warn, ...this.error].join("\n");
    },
    restore() {
      globalThis.fetch = realFetch;
      console.info = realInfo; console.warn = realWarn; console.error = realError;
      Math.random = realRandom;
      if (hadEdge) g.EdgeRuntime = realEdge;
      else delete g.EdgeRuntime;
    },
  };
  if (opts.env === false) {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  } else {
    Deno.env.set("SUPABASE_URL", "http://logger-qa.invalid");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-de-teste");
  }
  const respond = opts.respond ?? (() => new Response(null, { status: 201 }));
  globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes("/rest/v1/runtime_logs")) return new Response(null, { status: 201 });
    const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "null");
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Row[];
    h.posts.push(rows);
    return await respond(rows);
  }) as typeof fetch;
  const fmt = (a: unknown[]) => a.map((x) => (typeof x === "string" ? x : Deno.inspect(x, { depth: 10 }))).join(" ");
  console.info = (...a: unknown[]) => h.info.push(fmt(a));
  console.warn = (...a: unknown[]) => h.warn.push(fmt(a));
  console.error = (...a: unknown[]) => h.error.push(fmt(a));
  if (opts.random) Math.random = opts.random;
  if (opts.edge) g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => h.waitUntil.push(p) };
  return h;
}

async function run(opts: Parameters<typeof install>[0], fn: (h: H) => Promise<void>): Promise<H> {
  const h = install(opts);
  try {
    await fn(h);
  } finally {
    await flushRuntimeLogs();
    h.restore();
  }
  return h;
}

/** Drena o que o runtime recebeu em waitUntil, como o Edge Runtime faria. */
async function drainWaitUntil(h: H): Promise<void> {
  let seen = 0;
  while (seen < h.waitUntil.length) {
    const batch = h.waitUntil.slice(seen);
    seen = h.waitUntil.length;
    await Promise.all(batch);
  }
}

const relatos = (h: H) => h.error.filter((l) => l.includes('"function_name":"logRuntime"')).length;
function semCru(texto: string, canal: string) {
  for (const c of CRUS) assert(!texto.includes(c), `${canal}: valor cru '${c}' vazou`);
}

// ─── 1. Volume ───────────────────────────────────────────────────────────────

Deno.test("volume — 1 invocação típica (dispatched→process), tudo sorteado dentro: 1 POST", async () => {
  const h = await run({ edge: true, random: () => 0 }, async (h) => {
    await webhookEvent(logRuntime, () => 0.25, 1);
    assertEquals(h.posts.length, 0, "nada sai antes da janela");
    await drainWaitUntil(h);
  });
  assertEquals(h.posts.length, 1);
  assertEquals(h.posts[0].length, 2);
});

Deno.test("volume — 1.000 eventos em rajada: 1 POST por janela, ~1% ao banco, nada some", async () => {
  const ev = mulberry32(42);
  let calls = 0;
  const h = await run({ edge: true, random: mulberry32(1337) }, async (h) => {
    for (let i = 0; i < 1000; i++) calls += await webhookEvent(logRuntime, ev, i);
    await drainWaitUntil(h);
  });
  const rows = h.posts.flat();
  const rt1 = h.info.filter((l) => l.startsWith('{"rt":1')).length;
  console.log(`[QA volume rajada] chamadas=${calls} POSTs=${h.posts.length} linhas_banco=${rows.length} rt1=${rt1} fração=${(rows.length / calls).toFixed(4)}`);
  assertEquals(rows.length + rt1, calls, "toda chamada vira linha no banco OU rt:1");
  assertEquals(h.posts.length, 1, "uma janela = um POST");
  for (const r of rows) assert(typeof (r.payload_snapshot as Row)._sample_rate === "number");
  const ratio = rows.length / calls;
  assert(ratio > 0.005 && ratio < 0.03, `fração ao banco ${ratio}`);
});

Deno.test("volume — 200 eventos isolados (waitUntil drenado a cada requisição): ≤1 POST por evento", async () => {
  const ev = mulberry32(99);
  let max = 0, total = 0, calls = 0;
  await run({ edge: true, random: mulberry32(2024) }, async (h) => {
    for (let i = 0; i < 200; i++) {
      const antes = h.posts.length;
      calls += await webhookEvent(logRuntime, ev, i);
      await drainWaitUntil(h);
      const d = h.posts.length - antes;
      max = Math.max(max, d);
      total += d;
    }
  });
  console.log(`[QA volume isolado] eventos=200 chamadas=${calls} POSTs=${total} max_por_evento=${max}`);
  assert(max <= 1);
});

// ─── 2. Nenhuma perda de erro ────────────────────────────────────────────────

Deno.test("erro — 1.000 chamadas (5% erro): 100% dos erros no banco, cada um sem esperar a janela", async () => {
  const enviados: string[] = [];
  const h = await run({ edge: true, random: mulberry32(5) }, async (h) => {
    for (let i = 0; i < 1000; i++) {
      if (i % 20 === 0) {
        const id = `erro_${i}`;
        enviados.push(id);
        const t0 = performance.now();
        await logRuntime({ module: "webhook", action: "uazapi_process_error", status: "error", entityId: id, organizationId: ORG });
        await h.waitUntil[h.waitUntil.length - 1];
        assert(h.posts.flat().some((r) => r.entity_id === id), `erro ${id} não saiu na hora`);
        assert(performance.now() - t0 < 150, "erro esperou a janela");
      } else {
        await logRuntime({ module: "webhook", action: "uazapi_process", status: "success" });
      }
    }
    await drainWaitUntil(h);
  });
  const gravados = h.posts.flat().filter((r) => r.status === "error").map((r) => r.entity_id as string);
  console.log(`[QA erro] enviados=${enviados.length} gravados=${gravados.length} POSTs=${h.posts.length}`);
  assertEquals(gravados.sort(), enviados.sort());
});

Deno.test("erro — isolate 'morrendo' (void, sem await, sem flush): waitUntil leva tudo", async () => {
  // Sem `run`: não há flushRuntimeLogs no fim — só o waitUntil salva as linhas.
  const h = install({ edge: true });
  try {
    for (let i = 0; i < 30; i++) {
      void logRuntime({ module: "webhook", action: "notificame_process", status: "success", entityId: `s${i}` });
    }
    void logRuntime({ module: "webhook", action: "uazapi_process_error", status: "error", entityId: "e1" });
    assert(h.waitUntil.length >= 1, "nada foi entregue ao waitUntil");
    await drainWaitUntil(h);
    assertEquals(h.posts.flat().length, 31);
    assert(h.posts.length <= 2, `POSTs=${h.posts.length}`);
  } finally {
    await flushRuntimeLogs();
    h.restore();
  }
});

Deno.test("erro — beforeunload esvazia a fila sem esperar a janela", async () => {
  await run({ edge: true }, async (h) => {
    for (let i = 0; i < 5; i++) await logRuntime({ module: "general", action: "probe_unload", status: "success" });
    assertEquals(h.posts.length, 0);
    globalThis.dispatchEvent(new Event("beforeunload"));
    await new Promise((r) => setTimeout(r, 10));
    assertEquals(h.posts.length, 1, "beforeunload não disparou o flush");
    assertEquals(h.posts[0].length, 5);
  });
});

// ─── 3. PII ──────────────────────────────────────────────────────────────────

Deno.test("PII — rt:1 (sorteada fora) não carrega nada cru", async () => {
  const h = await run({ random: () => 0.999 }, async () => {
    await logRuntime({
      organizationId: ORG, module: "webhook", action: "uazapi_process", status: "success",
      payloadSnapshot: PAYLOAD, reasoning: REASONING,
    });
  });
  assertEquals(h.posts.length, 0);
  assertEquals(h.info.length, 1);
  semCru(h.console, "rt:1");
});

Deno.test("PII — lote perdido + db_details 'Failing row contains' não carregam nada cru", async () => {
  const failing = `Failing row contains (${ORG}, webhook, ${REASONING}, ${JSON.stringify(PAYLOAD)})`;
  const h = await run({
    respond: () =>
      new Response(JSON.stringify({ code: "23502", details: failing, hint: null, message: "null value violates not-null" }), {
        status: 400, headers: { "content-type": "application/json" },
      }),
  }, async () => {
    await logRuntime({
      organizationId: ORG, module: "copilot", action: "decide", status: "error",
      payloadSnapshot: PAYLOAD, reasoning: REASONING, errorMessage: `Bearer ${TOKEN}`,
    });
  });
  assert(h.warn.some((l) => l.includes("perdido")));
  semCru(h.console, "lote perdido/db_details");
});

Deno.test("PII — banco recebe payload_snapshot = redactSecrets(payload) (+_sample_rate quando amostrada)", async () => {
  const h = await run({ random: () => 0 }, async () => {
    await logRuntime({ organizationId: ORG, module: "webhook", action: "uazapi_process", status: "success", payloadSnapshot: PAYLOAD, reasoning: REASONING });
    await logRuntime({ organizationId: ORG, module: "general", action: "fora_da_tabela", status: "success", payloadSnapshot: PAYLOAD });
  });
  const [amostrada, inteira] = h.posts.flat();
  assertEquals(amostrada.payload_snapshot, { ...(redactSecrets(PAYLOAD) as Row), _sample_rate: 0.01 });
  assertEquals(inteira.payload_snapshot, redactSecrets(PAYLOAD));
  assertEquals(amostrada.reasoning, REASONING, "reasoning inteiro ao banco (pré-existente, master-only)");
});

// ─── 4. Falha de lote ────────────────────────────────────────────────────────

Deno.test("falha — banco 500 com 100 linhas: 1 POST, 1 relato, console seguro", async () => {
  const h = await run({
    respond: () => new Response(JSON.stringify({ code: "XX000", details: null, hint: null, message: "internal" }), { status: 500, headers: { "content-type": "application/json" } }),
  }, async () => {
    for (let i = 0; i < 100; i++) {
      await logRuntime({ organizationId: ORG, module: "general", action: "probe_500", status: "success", payloadSnapshot: PAYLOAD, reasoning: REASONING });
    }
  });
  assertEquals(h.posts.length, 1, "falha não-22/23 não pode virar 100 POSTs");
  assertEquals(relatos(h), 1);
  semCru(h.console, "500");
});

Deno.test("falha — fetch lança (rede fora): 1 relato, chamador intacto", async () => {
  const h = await run({ respond: () => Promise.reject(new TypeError("network down")) }, async () => {
    for (let i = 0; i < 10; i++) await logRuntime({ module: "general", action: "probe_rede", status: "success" });
  });
  assertEquals(h.posts.length, 1);
  assertEquals(relatos(h), 1);
});

Deno.test("falha — 22P02 em 1 de 100 linhas: as outras 99 gravadas", async () => {
  const gravadas: Row[] = [];
  const h = await run({
    respond: (rows) => {
      if (rows.some((r) => r.entity_id === "nao-e-uuid")) {
        return new Response(JSON.stringify({ code: "22P02", details: null, hint: null, message: "invalid input syntax for type uuid" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      gravadas.push(...rows);
      return new Response(null, { status: 201 });
    },
  }, async () => {
    for (let i = 0; i < 100; i++) {
      await logRuntime({ module: "general", action: `p${i}`, status: "success", entityId: i === 37 ? "nao-e-uuid" : undefined });
    }
  });
  console.log(`[QA 22P02] gravadas=${gravadas.length} POSTs=${h.posts.length} relatos=${relatos(h)}`);
  assertEquals(gravadas.length, 99);
  assert(!gravadas.some((r) => r.action === "p37"));
  assertEquals(h.posts.length, 101, "1 lote + 100 linha a linha");
  assertEquals(relatos(h), 1);
});

// ─── 5. Assinatura ───────────────────────────────────────────────────────────

Deno.test("assinatura — nunca lança: sem env, params inválidos, payload circular", async () => {
  await run({ env: false }, async (h) => {
    await logRuntime({ module: "general", action: "sem_env", status: "error" });
    assertEquals(h.posts.length, 0);
  });
  await run({}, async () => {
    await logRuntime(undefined as unknown as Parameters<typeof logRuntime>[0]);
    await logRuntime(null as unknown as Parameters<typeof logRuntime>[0]);
    const circ: Row = { a: 1 };
    circ.self = circ;
    await logRuntime({ module: "general", action: "circ", status: "success", payloadSnapshot: circ });
  });
});

// ─── Bordas observadas ───────────────────────────────────────────────────────

Deno.test("borda — error_message com JID/e-mail em lote perdido sai MASCARADO no console", async () => {
  const h = await run({
    respond: () => new Response(JSON.stringify({ code: "XX000", details: null, hint: null, message: "internal" }), { status: 500, headers: { "content-type": "application/json" } }),
  }, async () => {
    await logRuntime({
      organizationId: ORG, module: "whatsapp", action: "sendMedia", status: "error",
      errorMessage: `falha ao enviar para 5511987654321@s.whatsapp.net (contato fulano.silva@exemplo.com.br)`,
    });
  });
  assertEquals(h.posts.flat()[0].error_message,
    "falha ao enviar para 5511987654321@s.whatsapp.net (contato fulano.silva@exemplo.com.br)",
    "o banco recebe o texto original");
  assert(!h.console.includes("5511987654321"), "telefone cru no console");
  assert(!h.console.includes("fulano.silva@exemplo.com.br"), "e-mail cru no console");
  assert(h.console.includes("5511*****4321@s.whatsapp.net"), "JID mascarado mantém prefixo, sufixo e domínio");
});

Deno.test("borda — BigInt numa linha derruba o lote inteiro?", async () => {
  const h = await run({}, async () => {
    for (let i = 0; i < 5; i++) await logRuntime({ module: "general", action: `b${i}`, status: "success" });
    await logRuntime({ module: "general", action: "bigint", status: "success", payloadSnapshot: { n: 10n } });
  });
  console.log(`[QA borda bigint] POSTs=${h.posts.length} linhas=${h.posts.flat().length} relatos=${relatos(h)} warn=${h.warn.length}`);
});
