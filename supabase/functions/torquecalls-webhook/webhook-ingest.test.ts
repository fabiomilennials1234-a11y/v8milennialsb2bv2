/**
 * Testes do endpoint de ingestão do webhook da VPS (S11 / T8).
 *
 * A T7 já provou o verificador. O que ESTES testes provam é a FIAÇÃO — as
 * perguntas que só existem quando há um handler HTTP no meio:
 *
 *   1. A ordem das barreiras é real? (nada abre banco antes da assinatura)
 *   2. O corpo chega CRU até a verificação? (a armadilha que recusaria 100% do
 *      tráfego de produção com o sintoma "o CRM ignora os eventos")
 *   3. Cada desfecho da RPC vira o status HTTP que o contrato manda?
 *   4. A recusa vaza alguma coisa? (motivo no corpo, nome de env, CORS)
 *
 * O banco é falso e a fábrica é contada: "o banco não foi aberto" é asserção,
 * não promessa de comentário.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { __resetWebhookKeysForTests } from "../_shared/voip/webhook-verify.ts";
import {
  __burstSizeForTests,
  __resetBurstForTests,
  type Admin,
  BURST_MAX_PER_IP,
  BURST_MAX_TRACKED,
  handleVpsEvent,
  MAX_DETAIL_CHARS,
  MAX_IP_CHARS,
} from "./index.ts";

// ─── utilitários ────────────────────────────────────────────────────────────

/** Ver a nota do mesmo apelido em webhook-verify.ts: TS 5.7 + WebCrypto. */
type Bytes = Uint8Array<ArrayBuffer>;

const AUD = "torquecrm-webhook.test";
const ENV = "test";
const SID = "tc-sessao-1";

/**
 * Corpo no formato que o Go emite: ordem de campo da struct (NÃO alfabética) e
 * `&` escapado como `&`, que é o padrão do `json.Marshal`. Os dois
 * detalhes existem para que `JSON.stringify(JSON.parse(corpo)) !== corpo` — é
 * essa desigualdade que dá dente ao teste do corpo cru.
 */
const GO_BODY =
  '{"sessionId":"tc-sessao-1","callId":"tc-call-9","direction":"outbound",' +
  '"type":"call-ended","reason":"user_ended","nota":"Alfa \\u0026 Beta"}';

function b64urlFromBytes(bytes: Bytes): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}

function bytesFromB64url(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Pair {
  priv: CryptoKey;
  kid: string;
  entry: string;
}

/** Espelha `webhookKID` do Go: 8 primeiros hex do SHA-256 da pública. */
async function makePair(): Promise<Pair> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const pub = bytesFromB64url(jwk.x!);
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", pub));
  const kid = [...sum.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { priv: kp.privateKey, kid, entry: `${kid}:${b64urlFromBytes(pub)}` };
}

function install(pubkeyEnv: string): void {
  Deno.env.set("TORQUECALLS_WEBHOOK_PUBKEY", pubkeyEnv);
  Deno.env.set("TORQUECALLS_WEBHOOK_AUDIENCE", AUD);
  Deno.env.set("TORQUECALLS_ENV", ENV);
  __resetWebhookKeysForTests();
  __resetBurstForTests();
}

/** Tradução do `signWebhook` do Go — `bh` sobre os bytes CRUS do corpo. */
async function signEnvelope(opts: {
  priv: CryptoKey;
  kid: string;
  body?: string;
  claims?: Record<string, unknown>;
}): Promise<string> {
  const body = opts.body ?? GO_BODY;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const iat = Math.floor(Date.now() / 1000);

  const header = { alg: "EdDSA", typ: "JWT", kid: opts.kid };
  const payload = {
    iss: "torquecalls-vps",
    aud: AUD,
    env: ENV,
    iat,
    exp: iat + 300,
    jti: crypto.randomUUID(),
    sid: SID,
    bh: b64urlFromBytes(digest),
    epoch: 7,
    seq: 13,
    ...opts.claims,
  };

  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${
    b64urlFromString(JSON.stringify(payload))
  }`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      opts.priv,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64urlFromBytes(sig)}`;
}

function post(body: string, token?: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/torquecalls-webhook", {
    method: "POST",
    body,
    headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
  });
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/** Banco falso. Conta ABERTURAS, não só chamadas — a ordem depende disso. */
function fakeDb(reply: { data?: unknown; error?: unknown } = {}) {
  const calls: RpcCall[] = [];
  let opened = 0;
  const open = (): Admin => {
    opened++;
    return {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({
          data: reply.data ?? null,
          error: reply.error ?? null,
        });
      },
    } as unknown as Admin;
  };
  return { open, calls, opened: () => opened };
}

const APPLIED = { ok: true, code: "applied", detail: "ended" };

/**
 * Captura as linhas que `logRuntime` REALMENTE manda para `runtime_logs`.
 *
 * `logRuntime` abre o próprio cliente a partir do ambiente e insere direto —
 * não há parâmetro para injetar nada. A única costura honesta é o `fetch` que o
 * supabase-js usa por baixo: o que passa por aqui são os bytes que sairiam para
 * o banco, depois do `redactSecrets`, que é exatamente o que se quer medir.
 *
 * Sem isto, um teste de truncamento só consegue afirmar que a ENTRADA era
 * grande — nunca que a SAÍDA é pequena, que é a propriedade que importa.
 */
async function captureRuntimeLogs<T>(
  run: () => Promise<T>,
): Promise<{ result: T; rows: Record<string, unknown>[] }> {
  const rows: Record<string, unknown>[] = [];
  const fetchReal = globalThis.fetch;
  const urlReal = Deno.env.get("SUPABASE_URL");
  const keyReal = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  Deno.env.set("SUPABASE_URL", "http://runtime-logs.invalido");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-de-teste");

  globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
    const href = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;

    if (href.includes("runtime_logs")) {
      const cru = typeof init?.body === "string" ? init.body : "";
      try {
        const parsed = JSON.parse(cru);
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) rows.push(row);
      } catch {
        rows.push({ __corpo_nao_json: cru });
      }
    }
    return Promise.resolve(
      new Response("[]", { status: 201, headers: { "Content-Type": "application/json" } }),
    );
  }) as typeof fetch;

  try {
    return { result: await run(), rows };
  } finally {
    globalThis.fetch = fetchReal;
    if (urlReal === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", urlReal);
    if (keyReal === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", keyReal);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. AS TRÊS REJEIÇÕES DO PASSO 3 DO BRIEF
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("sem Authorization → 401, e o banco NÃO é aberto", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const res = await handleVpsEvent(post(GO_BODY), db.open);

  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unauthorized" });
  assertEquals(
    db.opened(),
    0,
    "assinatura vem ANTES do banco — abrir cliente aqui é o que vira amplificação",
  );
});

Deno.test("assinatura de OUTRA chave → 401, e o banco NÃO é aberto", async () => {
  const boa = await makePair();
  const intrusa = await makePair();
  install(boa.entry);
  const db = fakeDb({ data: APPLIED });

  // kid da chave BOA, assinatura da INTRUSA: o caminho que um atacante com
  // acesso ao valor público (a VPS o imprime no boot) tentaria.
  const token = await signEnvelope({ priv: intrusa.priv, kid: boa.kid });
  const res = await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(res.status, 401);
  assertEquals(db.opened(), 0);
});

Deno.test("corpo ALTERADO depois de assinado → 401, e o banco NÃO é aberto", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: GO_BODY });
  const adulterado = GO_BODY.replace("user_ended", "timeout");
  assertNotEquals(adulterado, GO_BODY);

  const res = await handleVpsEvent(post(adulterado, token), db.open);

  assertEquals(res.status, 401, "é o bh amarrando envelope e corpo");
  assertEquals(db.opened(), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. O CORPO CRU — a armadilha que recusaria 100% do tráfego de produção
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("o corpo do Go, com escape e ordem de struct, é aceito CRU", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: GO_BODY });
  const res = await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(
    res.status,
    200,
    "se o handler tivesse feito req.json() e reserializado, o bh não bateria e " +
      "TODO webhook de produção viraria 401",
  );
  assertEquals(db.calls.length, 1);
});

Deno.test("o MESMO corpo reserializado é recusado — o defeito é concreto", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const reserializado = JSON.stringify(JSON.parse(GO_BODY));
  assertNotEquals(
    reserializado,
    GO_BODY,
    "se o corpo de teste virasse idêntico após reserializar, este alerta perde " +
      "a força — troque o payload por um com escape \\u ou ordem numérica",
  );

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: GO_BODY });
  const res = await handleVpsEvent(post(reserializado, token), db.open);

  assertEquals(res.status, 401);
  assertEquals(db.opened(), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. O QUE VAI PARA A RPC SAI DAS CLAIMS, NÃO DO CORPO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("sid, epoch, seq e jti vêm das CLAIMS assinadas, nunca do corpo", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  // O corpo MENTE: outra sessão, outro epoch, outro seq. Nada disso pode
  // atravessar — quem ordena e quem identifica está assinado.
  const corpoMentiroso = JSON.stringify({
    type: "call-ended",
    id: "tc-call-9",
    reason: "user_ended",
    sid: "tc-sessao-de-outra-org",
    epoch: 99999,
    seq: 99999,
    organization_id: "00000000-0000-0000-0000-000000000000",
  });

  const jti = crypto.randomUUID();
  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    body: corpoMentiroso,
    claims: { jti, sid: SID, epoch: 7, seq: 13 },
  });

  const res = await handleVpsEvent(post(corpoMentiroso, token), db.open);
  assertEquals(res.status, 200);

  assertEquals(db.calls[0].fn, "fn_voip_apply_vps_event");
  assertEquals(db.calls[0].args.p_sid, SID);
  assertEquals(db.calls[0].args.p_epoch, 7);
  assertEquals(db.calls[0].args.p_seq, 13);
  assertEquals(db.calls[0].args.p_event_jti, jti);
  assertEquals(
    Object.keys(db.calls[0].args).includes("p_organization_id"),
    false,
    "a organização sai de voip_sessions dentro da RPC, nunca daqui",
  );
});

Deno.test("p_signed_at é o iat do envelope, não o relógio do CRM", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const iat = Math.floor(Date.now() / 1000) - 20;
  const token = await signEnvelope({ priv: k.priv, kid: k.kid, claims: { iat, exp: iat + 300 } });

  await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(db.calls[0].args.p_signed_at, new Date(iat * 1000).toISOString());
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. O MAPA DE CÓDIGOS DA RPC → STATUS HTTP
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("cada código da RPC vira o status que o contrato manda", async () => {
  const esperado: Array<[string, boolean, number]> = [
    ["applied", true, 200],
    ["replay", true, 200],
    ["out_of_order", true, 200],
    ["session_not_found", true, 202],
    ["session_inert", true, 202],
    // Entrada E2: `peer` que não cabe em voip_calls.peer_phone. 202 e ok=true
    // porque é recusa ESPERADA — 409 faria a VPS registrar `CRM RECUSOU` em
    // nível error a cada oferta de conta LID.
    ["peer_unusable", true, 202],
    ["transition_refused", false, 409],
  ];

  for (const [code, ok, status] of esperado) {
    const k = await makePair();
    install(k.entry);
    const db = fakeDb({ data: { ok, code } });

    const token = await signEnvelope({ priv: k.priv, kid: k.kid });
    const res = await handleVpsEvent(post(GO_BODY, token), db.open);

    assertEquals(res.status, status, `código ${code}`);
    assertEquals(await res.json(), { ok, code });
  }
});

// Uma recusa, UM registro.
//
// `peer_unusable` é o desfecho de uma oferta de entrada cujo `peer` não cabe em
// `voip_calls.peer_phone`, e a RPC já escreve `webhook_entrada_sem_telefone` com
// o peer, a contagem de dígitos e a faixa aceita. Uma linha daqui seria a
// SEGUNDA por oferta — e mais pobre, porque neste ponto o corpo já não está em
// mãos. A população existe (conta LID sem `caller_pn`, oferta de grupo), então
// isso seria ruído permanente em nível `error`.
//
// O controle é `transition_refused`, que CONTINUA escrevendo: recusa de
// transição é o desfecho que merece olho humano, e nada aqui pode enfraquecê-la.
Deno.test({
  name: "peer_unusable NÃO gera linha de runtime_logs; transition_refused gera",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    {
      const k = await makePair();
      install(k.entry);
      const db = fakeDb({ data: { ok: true, code: "peer_unusable", detail: "peer_phone_unusable" } });
      const token = await signEnvelope({ priv: k.priv, kid: k.kid });

      const { result, rows } = await captureRuntimeLogs(() =>
        handleVpsEvent(post(GO_BODY, token), db.open)
      );

      assertEquals(result.status, 202, "recusa esperada não é 4xx");
      assertEquals(rows.length, 0, "o endpoint NÃO pode dobrar o registro da RPC");
    }

    {
      const k = await makePair();
      install(k.entry);
      const db = fakeDb({ data: { ok: false, code: "transition_refused", detail: "unknown_type" } });
      const token = await signEnvelope({ priv: k.priv, kid: k.kid });

      const { result, rows } = await captureRuntimeLogs(() =>
        handleVpsEvent(post(GO_BODY, token), db.open)
      );

      assertEquals(result.status, 409);
      assertEquals(rows.length, 1, "transition_refused continua deixando rastro");
      assertEquals(rows[0].action, "webhook_transicao_recusada");
      assertEquals(rows[0].status, "error");
    }
  },
});

Deno.test("código FORA do contrato vira 500, não 200 silencioso", async () => {
  const k = await makePair();
  install(k.entry);
  // Deriva entre a migration e esta função. O caminho errado seria devolver
  // 200 sobre um desfecho que ninguém mapeou.
  const db = fakeDb({ data: { ok: true, code: "codigo_que_ninguem_mapeou" } });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid });
  const res = await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "internal_error" });
});

Deno.test("falha do banco vira 500 com corpo genérico", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ error: { message: 'relation "voip_sessions" does not exist' } });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid });
  const res = await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(res.status, 500);
  const corpo = await res.text();
  assertEquals(corpo.includes("voip_sessions"), false, "erro de banco não vaza no corpo");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ENVELOPE AUTENTICADO MAS MALFORMADO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("jti que não é UUID é 400 aqui, não 22P02 lá dentro", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, claims: { jti: "nao-e-uuid" } });
  const res = await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(res.status, 400);
  assertEquals(
    db.calls.length,
    0,
    "deixar passar abortaria a transação e culparia o CRM por envelope da VPS",
  );
});

Deno.test("corpo assinado que não é objeto JSON é 400, e a RPC não é chamada", async () => {
  for (const corpo of ["[1,2,3]", '"só uma string"', "não é json", "null"]) {
    const k = await makePair();
    install(k.entry);
    const db = fakeDb({ data: APPLIED });

    const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: corpo });
    const res = await handleVpsEvent(post(corpo, token), db.open);

    assertEquals(res.status, 400, `corpo ${corpo}`);
    assertEquals(db.calls.length, 0, `corpo ${corpo}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. BARREIRAS 1 E 2 — antes da assinatura
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("corpo acima do teto é 413 sem sequer alcançar o verificador", async () => {
  // A configuração está QUEBRADA de propósito: se o verificador fosse
  // alcançado, ele lançaria e a resposta seria 500. O 413 é a prova de que o
  // teto de tamanho vem antes.
  Deno.env.delete("TORQUECALLS_WEBHOOK_PUBKEY");
  __resetWebhookKeysForTests();
  __resetBurstForTests();

  const db = fakeDb({ data: APPLIED });
  const gigante = `{"lixo":"${"A".repeat(80 * 1024)}"}`;
  const res = await handleVpsEvent(post(gigante, "irrelevante"), db.open);

  assertEquals(res.status, 413);
  assertEquals(db.opened(), 0);
});

Deno.test("rajada é barrada antes de tudo — inclusive antes de ler o corpo", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });
  const ip = { "x-forwarded-for": "203.0.113.77" };

  let ultimo = 0;
  for (let i = 0; i <= BURST_MAX_PER_IP; i++) {
    const res = await handleVpsEvent(post("{}", undefined, ip), db.open);
    ultimo = res.status;
    await res.body?.cancel();
  }

  assertEquals(ultimo, 429, "a requisição além do teto tem que ser barrada");
  assertEquals(db.opened(), 0);

  // Outro endereço não herda o castigo do primeiro.
  const outro = await handleVpsEvent(
    post("{}", undefined, { "x-forwarded-for": "198.51.100.4" }),
    db.open,
  );
  assertEquals(outro.status, 401, "endereço novo passa pela rajada e morre na assinatura");
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. O QUE A RESPOSTA NÃO PODE CARREGAR
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("configuração quebrada é 500, e o corpo NÃO nomeia a variável", async () => {
  Deno.env.delete("TORQUECALLS_WEBHOOK_PUBKEY");
  __resetWebhookKeysForTests();
  __resetBurstForTests();

  const db = fakeDb({ data: APPLIED });
  const res = await handleVpsEvent(post(GO_BODY, "qualquer.coisa.aqui"), db.open);

  assertEquals(res.status, 500, "config quebrada é 500; 401 mandaria olhar a VPS");
  const corpo = await res.text();
  assertEquals(corpo.includes("TORQUECALLS"), false);
  assertEquals(corpo.includes("PUBKEY"), false);
  assertEquals(db.opened(), 0);
});

Deno.test("a recusa não diz QUAL checagem falhou — oráculo de graça, não", async () => {
  const k = await makePair();
  const outra = await makePair();

  const casos: Array<[string, string]> = [];

  install(k.entry);
  casos.push(["assinatura de outra chave", await signEnvelope({ priv: outra.priv, kid: k.kid })]);
  casos.push(["kid desconhecido", await signEnvelope({ priv: outra.priv, kid: outra.kid })]);
  casos.push([
    "expirado",
    await signEnvelope({ priv: k.priv, kid: k.kid, claims: { iat: 1000, exp: 1300 } }),
  ]);

  const corpos = new Set<string>();
  for (const [nome, token] of casos) {
    __resetBurstForTests();
    const res = await handleVpsEvent(post(GO_BODY, token), fakeDb().open);
    assertEquals(res.status, 401, nome);
    corpos.add(await res.text());
  }

  assertEquals(corpos.size, 1, "todas as recusas devolvem o MESMO corpo");
  assertEquals([...corpos][0], JSON.stringify({ error: "unauthorized" }));
});

Deno.test("sem CORS e sem OPTIONS — quem chama é a VPS, não um navegador", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb({ data: APPLIED });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid });
  const ok = await handleVpsEvent(post(GO_BODY, token), db.open);

  assertEquals(ok.headers.get("access-control-allow-origin"), null);
  assertEquals(ok.headers.get("access-control-allow-headers"), null);
  // Os headers de segurança CONTINUAM — o que sai é o CORS, não a blindagem.
  assertEquals(ok.headers.get("x-content-type-options"), "nosniff");
  assertEquals(ok.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");

  for (const method of ["OPTIONS", "GET", "PUT", "DELETE"]) {
    __resetBurstForTests();
    const res = await handleVpsEvent(
      new Request("http://localhost/torquecalls-webhook", { method }),
      db.open,
    );
    assertEquals(res.status, 405, `${method} não tem tratamento especial`);
    assertEquals(res.headers.get("access-control-allow-origin"), null);
    await res.body?.cancel();
  }
});

Deno.test("método errado em loop é barrado pela rajada — 429 vence 405", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb();
  const ip = { "x-forwarded-for": "203.0.113.99" };

  // O 405 é uma das duas recusas que NÃO geram linha em runtime_logs, e a
  // justificativa escrita no arquivo é que o limitador roda ACIMA dele. Se
  // alguém trocar a ordem, a justificativa vira mentira e uma enxurrada de GET
  // passa a escapar do limitador inteira. Este teste é o que amarra as duas
  // coisas: enquanto ele for verde, a declaração no comentário é verdadeira.
  let ultimo = 0;
  for (let i = 0; i <= BURST_MAX_PER_IP; i++) {
    const res = await handleVpsEvent(
      new Request("http://localhost/torquecalls-webhook", { method: "GET", headers: ip }),
      db.open,
    );
    ultimo = res.status;
    await res.body?.cancel();
  }

  assertEquals(ultimo, 429, "GET em loop tem que consumir ficha, não escapar pelo 405");
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. O QUE CHEGA A `runtime_logs`
// ═══════════════════════════════════════════════════════════════════════════
//
// A versão anterior deste teste media o TOKEN, não o log — e ficava verde com o
// `clip` removido por inteiro. Media que a entrada era grande, nunca que a
// saída era pequena. Estes exigem os bytes que realmente saem para o banco.

Deno.test({
  name: "detalhe e endereço chegam TRUNCADOS ao runtime_logs",
  // Este é o único teste em que `logRuntime` chega até o `createClient` de
  // verdade (os outros saem cedo, sem SUPABASE_URL no ambiente). E o
  // `createClient` de `_shared/logger.ts` não passa `autoRefreshToken: false`,
  // então o auth-js arma um `setInterval` que ninguém desarma — medido com
  // `--trace-leaks`: `B._startAutoRefresh`, auth-js 2.105.4. O vazamento é do
  // logger, não deste teste, e `_shared/logger.ts` está fora do escopo desta
  // tarefa (vira issue própria). Os sanitizadores ficam desligados AQUI e só
  // aqui — os outros 18 testes seguem com eles ligados.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const k = await makePair();
    install(k.entry);

    // Os dois campos que o atacante controla e que o verificador devolve
    // inteiros, pré-assinatura e sem teto: `aud` (vira `detail`) e o
    // `x-forwarded-for` (vira `source_ip`). Sem corte, uma requisição de um
    // atacante vira uma linha de 100 KB em runtime_logs — de graça, e sem ele
    // precisar de credencial nenhuma.
    const audEnorme = "A".repeat(50_000);
    const ipEnorme = "9".repeat(50_000);
    const token = await signEnvelope({ priv: k.priv, kid: k.kid, claims: { aud: audEnorme } });

    const { result, rows } = await captureRuntimeLogs(() =>
      handleVpsEvent(post(GO_BODY, token, { "x-forwarded-for": ipEnorme }), fakeDb().open)
    );

    assertEquals(result.status, 401);
    assertEquals(rows.length, 1, "a recusa tem que ter gerado exatamente uma linha");

    const snapshot = rows[0].payload_snapshot as Record<string, unknown>;
    assertEquals(snapshot.motivo, "wrong_audience");

    const detalhe = String(snapshot.detalhe);
    const ip = String(snapshot.source_ip);

    assertEquals(
      detalhe.length,
      MAX_DETAIL_CHARS + `…[+${50_000 - MAX_DETAIL_CHARS}]`.length,
      `detalhe chegou com ${detalhe.length} caracteres`,
    );
    assertEquals(
      ip.length,
      MAX_IP_CHARS + `…[+${50_000 - MAX_IP_CHARS}]`.length,
      `source_ip chegou com ${ip.length} caracteres`,
    );

    // O corte tem que preservar o começo (é o que serve ao diagnóstico) e dizer
    // quanto foi cortado (senão "A×160" é indistinguível de uma aud legítima).
    assert(detalhe.startsWith("AAAA"), "o começo do valor original tem que sobreviver");
    assert(detalhe.endsWith(`[+${50_000 - MAX_DETAIL_CHARS}]`), "o corte tem que se declarar");

    // A rede que pega qualquer campo novo que alguém acrescente sem teto.
    const linha = JSON.stringify(rows[0]);
    assert(
      linha.length < 1_000,
      `a linha inteira foi para o banco com ${linha.length} bytes — algum campo escapou do corte`,
    );
  },
});

Deno.test("o mapa do limitador não cresce sem limite dentro do isolate", async () => {
  const k = await makePair();
  install(k.entry);
  const db = fakeDb();

  // Endereço forjado por requisição é o ataque contra o PRÓPRIO limitador: cada
  // um novo é uma entrada nova no mapa, e o mapa vive no isolate. Sem a guarda
  // de BURST_MAX_TRACKED, a memória sobe até o isolate morrer — e nenhuma
  // resposta HTTP muda enquanto isso, que é por que este teste precisa olhar o
  // tamanho do mapa diretamente.
  const enderecos = BURST_MAX_TRACKED * 2;
  for (let i = 0; i < enderecos; i++) {
    const res = await handleVpsEvent(
      post("{}", undefined, {
        "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
      }),
      db.open,
    );
    await res.body?.cancel();
  }

  assert(
    __burstSizeForTests() <= BURST_MAX_TRACKED + 1,
    `${enderecos} endereços distintos deixaram ${__burstSizeForTests()} entradas no mapa; ` +
      `o teto é ${BURST_MAX_TRACKED + 1}`,
  );
  assertEquals(db.opened(), 0, "nada disso chega perto do banco");
});
