/**
 * A gravação chega ao CRM pelo webhook do S11 (Gravação S2, #1358).
 *
 * A COSTURA É A REUSADA. Não há endpoint novo e não há autenticação nova:
 * `recording-ready` e `recording-failed` entram pelo mesmo envelope assinado
 * que `call-status` e `call-ended` já usam, e é por isso que estes testes
 * montam o envelope do mesmo jeito que `webhook-ingest.test.ts`.
 *
 * ESTE ARQUIVO PROVA A FIAÇÃO, e só ela:
 *
 *   1. A busca é EFEITO do evento — disparada só quando a RPC diz que há o que
 *      buscar, com os argumentos que ELA devolveu (nunca os do corpo).
 *   2. A REENTREGA não rebusca: quando a RPC devolve `already_stored`, nada
 *      acontece. O anti-replay pelo `jti` NÃO cobre esse caso, porque a
 *      reentrega traz envelope novo — quem barra é o estado.
 *   3. Uma busca que falha ou explode NÃO derruba a entrega: o evento foi
 *      consumido, o `jti` está reservado, e a VPS não retenta.
 *
 * A OPERAÇÃO EM SI — buscar, guardar no bucket, registrar o endereço, limpar a
 * cópia da VPS — é provada em `_shared/voip/recording.test.ts`. A divisão não é
 * de gosto: só um `.test.ts` DENTRO de `_shared/voip/` pode instalar a chave
 * privada de brinquedo no ambiente, e `scripts/test-voip-choke.sh` trata
 * qualquer outro arquivo que sequer NOMEIE a variável do segredo como violação
 * do choke — inclusive em comentário, porque o detector é textual. Este arquivo
 * nunca cunha token: ele injeta a busca inteira como dublê.
 */

import { assertEquals } from "@std/assert";
import { __resetWebhookKeysForTests } from "../_shared/voip/webhook-verify.ts";
import { __resetBurstForTests, type Admin, handleVpsEvent } from "./index.ts";

type Bytes = Uint8Array<ArrayBuffer>;

const AUD = "torquecrm-webhook.test";
const ENV = "test";
const SID = "tc-sessao-1";
const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const CALL_ID = "11111111-2222-3333-4444-555555555555";
const TC_CALL = "0E65AD6F1122334455667788990011FF";

// ─── envelope (espelho do signWebhook do Go) ────────────────────────────────

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
  // Sem `TORQUECALLS_ENV` o verificador LANÇA (configuração quebrada) e toda
  // entrega vira 500. Depender de outro teste tê-lo deixado no ambiente faz o
  // resultado mudar com a ordem de execução.
  Deno.env.set("TORQUECALLS_ENV", ENV);
  __resetWebhookKeysForTests();
  __resetBurstForTests();
}

async function signEnvelope(opts: {
  priv: CryptoKey;
  kid: string;
  body: string;
}): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(opts.body)),
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
    seq: 21,
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

function post(body: string, token: string): Request {
  return new Request("http://localhost/torquecalls-webhook", {
    method: "POST",
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Corpo no formato que o Go emite: ordem de campo da struct, não alfabética. */
const READY_BODY = JSON.stringify({
  type: "recording-ready",
  sessionId: SID,
  id: TC_CALL,
  bytes: 720000,
  durationMs: 180000,
  callDurationMs: 180000,
  format: "ogg/opus",
  channels: 2,
});

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/** Cliente de banco do ENDPOINT. Guarda o que foi chamado, e nada além. */
function fakeAdmin(reply: { data?: unknown; error?: unknown } = {}) {
  const calls: RpcCall[] = [];
  const open = (): Admin =>
    ({
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
      },
    }) as unknown as Admin;
  return { open, calls };
}

/** Silencia `logRuntime`, que abre o próprio cliente a partir do ambiente. */
function muteRuntimeLogs<T>(run: () => Promise<T>): Promise<T> {
  const fetchReal = globalThis.fetch;
  const urlReal = Deno.env.get("SUPABASE_URL");
  Deno.env.delete("SUPABASE_URL");
  globalThis.fetch = (() => Promise.resolve(new Response("[]", { status: 201 }))) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = fetchReal;
    if (urlReal === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", urlReal);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. A BUSCA É EFEITO DO EVENTO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("recording-ready: a RPC manda buscar, e a busca sai com o que ela devolveu", async () => {
  const k = await makePair();
  install(k.entry);

  // O desfecho REAL da RPC quando há o que buscar. Os três campos vêm dela, e
  // não do corpo do evento: a organização nunca sai do que a VPS mandou —
  // `fn_voip_apply_vps_event` a resolve por `tc_session_id`.
  const admin = fakeAdmin({
    data: {
      ok: true,
      code: "applied",
      detail: "recording_pending",
      recording: "fetch",
      fetch_call_id: CALL_ID,
      tc_call_id: TC_CALL,
      organization_id: ORG,
    },
  });

  const vistos: Array<Record<string, unknown>> = [];
  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: READY_BODY });

  const res = await muteRuntimeLogs(() =>
    handleVpsEvent(post(READY_BODY, token), admin.open, {
      ingest: (_db, args) => {
        vistos.push({ ...args });
        return Promise.resolve({ ok: true, path: "x", bytes: 9 });
      },
    })
  );

  assertEquals(res.status, 200);
  assertEquals(vistos.length, 1, "a busca não foi disparada");
  assertEquals(vistos[0], {
    callId: CALL_ID,
    tcCallId: TC_CALL,
    // A SESSÃO VEM DA CLAIM ASSINADA, não do corpo. É a mesma regra que faz
    // todo o roteamento desta função sair das claims.
    sessionId: SID,
    organizationId: ORG,
  });
});

Deno.test("evento sem instrução de busca não dispara nada", async () => {
  // `call-ended` e os outros três tipos passam por aqui a cada chamada. Nenhum
  // deles pode acionar a busca por acidente.
  const k = await makePair();
  install(k.entry);

  const corpo = JSON.stringify({
    type: "call-ended",
    sessionId: SID,
    id: TC_CALL,
    reason: "user_ended",
    endedAt: Date.now(),
  });
  const admin = fakeAdmin({ data: { ok: true, code: "applied", detail: "ended" } });

  let buscas = 0;
  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: corpo });
  const res = await muteRuntimeLogs(() =>
    handleVpsEvent(post(corpo, token), admin.open, {
      ingest: () => {
        buscas++;
        return Promise.resolve({ ok: true, path: "x", bytes: 1 });
      },
    })
  );

  assertEquals(res.status, 200);
  assertEquals(buscas, 0);
});

Deno.test("instrução de busca incompleta é ignorada, não adivinhada", async () => {
  // Deriva de contrato entre a migration e esta função. Meia instrução não pode
  // virar busca com organização inventada: o objeto iria para `undefined/`, num
  // caminho que a policy do bucket não sabe avaliar.
  const k = await makePair();
  install(k.entry);

  for (
    const parcial of [
      { fetch_call_id: CALL_ID, tc_call_id: TC_CALL },
      { fetch_call_id: CALL_ID, organization_id: ORG },
      { tc_call_id: TC_CALL, organization_id: ORG },
    ]
  ) {
    const admin = fakeAdmin({ data: { ok: true, code: "applied", ...parcial } });
    let buscas = 0;
    const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: READY_BODY });
    await muteRuntimeLogs(() =>
      handleVpsEvent(post(READY_BODY, token), admin.open, {
        ingest: () => {
          buscas++;
          return Promise.resolve({ ok: true, path: "x", bytes: 1 });
        },
      })
    );
    assertEquals(buscas, 0, `instrução parcial ${JSON.stringify(parcial)} disparou busca`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. REENTREGA NÃO REBUSCA
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("reentrega sobre gravação já guardada não busca nada", async () => {
  const k = await makePair();
  install(k.entry);

  // O anti-replay pelo `jti` NÃO cobre este caso: a reentrega da VPS traz
  // envelope NOVO, com jti novo. Quem barra é o ESTADO — a RPC devolve
  // `already_stored` e não preenche `fetch_call_id`.
  const admin = fakeAdmin({
    data: {
      ok: true,
      code: "applied",
      detail: "recording_already_stored",
      recording: "already_stored",
      fetch_call_id: null,
      tc_call_id: null,
      organization_id: null,
    },
  });

  let buscas = 0;
  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: READY_BODY });
  const res = await muteRuntimeLogs(() =>
    handleVpsEvent(post(READY_BODY, token), admin.open, {
      ingest: () => {
        buscas++;
        return Promise.resolve({ ok: true, path: "x", bytes: 1 });
      },
    })
  );

  assertEquals(res.status, 200);
  assertEquals(
    buscas,
    0,
    "rebuscou uma gravação já guardada — o arquivo pode já ter sido apagado da VPS, " +
      "e a segunda busca marcaria FALHA numa gravação inteira",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A BUSCA NÃO DERRUBA A ENTREGA
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("busca que explode não muda o status da entrega", async () => {
  const k = await makePair();
  install(k.entry);

  const admin = fakeAdmin({
    data: {
      ok: true,
      code: "applied",
      detail: "recording_pending",
      fetch_call_id: CALL_ID,
      tc_call_id: TC_CALL,
      organization_id: ORG,
    },
  });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: READY_BODY });
  const res = await muteRuntimeLogs(() =>
    handleVpsEvent(post(READY_BODY, token), admin.open, {
      ingest: () => Promise.reject(new Error("rede morreu")),
    })
  );

  // O evento FOI consumido: o jti está reservado e o estado aplicado. Devolver
  // 500 faria a VPS registrar recusa sobre uma entrega correta — e ela não
  // retenta, então o único efeito seria diagnóstico errado.
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, code: "applied" });
});

Deno.test("busca que falha em silêncio também não muda o status da entrega", async () => {
  const k = await makePair();
  install(k.entry);

  const admin = fakeAdmin({
    data: {
      ok: true,
      code: "applied",
      fetch_call_id: CALL_ID,
      tc_call_id: TC_CALL,
      organization_id: ORG,
    },
  });

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: READY_BODY });
  const res = await muteRuntimeLogs(() =>
    handleVpsEvent(post(READY_BODY, token), admin.open, {
      // O desfecho normal de uma busca ruim: resolvida, com `ok: false`. Quem
      // registra `failed` no banco é `runRecordingIngest`; o endpoint só não
      // pode transformar isso em recusa da entrega.
      ingest: () => Promise.resolve({ ok: false, reason: "vps_http_404" }),
    })
  );

  assertEquals(res.status, 200);
});
