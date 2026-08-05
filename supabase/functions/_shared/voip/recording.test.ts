/**
 * A gravação viaja da VPS para o armazenamento do CRM (Gravação S2, #1358).
 *
 * Este arquivo prova a OPERAÇÃO — buscar, guardar, registrar, limpar. A fiação
 * do endpoint (quando a busca é disparada, e o que acontece com a entrega
 * quando ela falha) fica em `torquecalls-webhook/recording-ingest.test.ts`.
 *
 * POR QUE A DIVISÃO ESTÁ AQUI, e não é arbitrária: só um `.test.ts` DENTRO de
 * `_shared/voip/` pode instalar a chave privada de brinquedo no ambiente —
 * `scripts/test-voip-choke.sh` trata qualquer outro leitor de
 * `TORQUECALLS_SIGNING_SK` como violação, e a exceção é estreita de propósito
 * ("senão bastaria batizar o vazamento de teste"). O primeiro rascunho desta
 * fatia pôs tudo junto na pasta da edge function e o portão reprovou, que é
 * exatamente o trabalho dele.
 *
 * O QUE ESTES TESTES PROVAM:
 *
 *   1. O objeto vai para o caminho DERIVADO da organização e da chamada, e é
 *      esse mesmo caminho que `fn_voip_recording_stored` recebe.
 *   2. Toda falha da busca vira `fn_voip_recording_fetch_failed` COM A CAUSA —
 *      nunca ausência, que é o que o gestor lê como "não houve gravação". A
 *      função é a da BUSCA, e não `fn_voip_recording_failed` (que é a VPS
 *      avisando que arquivo não haverá): só a primeira reenfileira, e é essa
 *      diferença que impede tentar de novo o que nunca vai existir (S4, #1360).
 *   3. A cópia da VPS só é apagada DEPOIS de o endereço estar gravado, e nunca
 *      quando a busca falhou: nesse momento ela é a única que existe.
 *
 * SOBRE OS DUBLÊS
 * ---------------
 * Esta base já perdeu tempo com um dublê que ignorava a lista de colunas do
 * `select` e deixava passar mutante que quebrava todo o atendimento. Aqui a
 * regra é a mesma em outra forma: o dublê do armazenamento GUARDA o que recebeu
 * (bucket, caminho, bytes, content-type, upsert) e o do `fetch` devolve
 * EXATAMENTE o que um servidor devolveria — status, cabeçalhos e corpo, sem
 * "consertar" nenhum. Um upload que ignorasse o caminho faria o teste de
 * multi-tenancy passar com a organização errada gravada no objeto.
 */

import { assert, assertEquals } from "@std/assert";
import { __resetKeyCacheForTests } from "./internal/sign.ts";
import {
  fetchAndStoreRecording,
  MAX_RECORDING_BYTES,
  recordingObjectPath,
  type RecordingStore,
  runRecordingIngest,
} from "./recording.ts";

const SID = "tc-sessao-1";
const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const CALL_ID = "11111111-2222-3333-4444-555555555555";
const TC_CALL = "0E65AD6F1122334455667788990011FF";

/** O cabeçalho de um Ogg de verdade. É o que a busca confere antes de guardar. */
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x01, 0x02, 0x03]);

const ARGS = {
  callId: CALL_ID,
  tcCallId: TC_CALL,
  sessionId: SID,
  organizationId: ORG,
};

function bytesFromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Instala um par Ed25519 de brinquedo no formato que o Go emite (seed‖pub).
 *
 * Cunhar a credencial de verdade, em vez de burlar o assinador, é o que faz o
 * caminho exercitado ser o mesmo da produção: se `signAdminToken` passar a
 * exigir uma claim nova, estes testes ficam vermelhos em vez de continuarem
 * verdes sobre um token que a VPS recusaria.
 */
async function installSigner(): Promise<void> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const raw = new Uint8Array(64);
  raw.set(bytesFromB64url(priv.d!), 0);
  raw.set(bytesFromB64url(pub.x!), 32);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  Deno.env.set("TORQUECALLS_SIGNING_SK", btoa(bin));
  Deno.env.set("TORQUECALLS_SIGNING_KID", "tc-test");
  Deno.env.set("TORQUECALLS_AUDIENCE", "vps.invalido");
  Deno.env.set("TORQUECALLS_ENV", "test");
  Deno.env.set("TORQUECALLS_VPS_URL", "http://vps.invalido");
  __resetKeyCacheForTests();
}

// ─── dublês ─────────────────────────────────────────────────────────────────

interface Uploaded {
  bucket: string;
  path: string;
  bytes: number;
  contentType?: string;
  upsert?: boolean;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeStore(
  replies: Record<string, unknown> = {},
  opts: { uploadError?: { message: string } } = {},
) {
  const uploads: Uploaded[] = [];
  const rpcs: RpcCall[] = [];
  const db: RecordingStore = {
    storage: {
      from(bucket: string) {
        return {
          upload(
            path: string,
            body: ArrayBuffer | Uint8Array | Blob,
            o?: { contentType?: string; upsert?: boolean },
          ) {
            uploads.push({
              bucket,
              path,
              bytes: body instanceof Uint8Array
                ? body.byteLength
                : body instanceof ArrayBuffer
                ? body.byteLength
                : -1,
              contentType: o?.contentType,
              upsert: o?.upsert,
            });
            return Promise.resolve({ error: opts.uploadError ?? null });
          },
        };
      },
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      // `data` é o que a função de BANCO devolve. Poder trocá-la é o que faz o
      // teste do caminho infeliz (`path_mismatch`) existir.
      return Promise.resolve({
        data: fn in replies ? replies[fn] : "stored",
        error: null,
      });
    },
  };
  return { db, uploads, rpcs };
}

function fakeFetch(
  respostas: Array<{ status: number; body?: Uint8Array; headers?: Record<string, string> }>,
) {
  const seen: Array<{ url: string; method: string; auth: string | null }> = [];
  let i = 0;
  const fn = (url: string, init?: RequestInit) => {
    seen.push({
      url,
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("Authorization"),
    });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    const headers = new Headers(r.headers ?? {});
    if (r.body && !headers.has("content-length")) {
      headers.set("content-length", String(r.body.byteLength));
    }
    return Promise.resolve(
      new Response(r.body ? (r.body.slice().buffer as ArrayBuffer) : null, {
        status: r.status,
        headers,
      }),
    );
  };
  return { fn, seen };
}

/**
 * Silencia `logRuntime`, que abre o próprio cliente a partir do ambiente. Sem
 * isto cada teste tentaria falar com um Supabase que não existe.
 */
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
// 1. O ENDEREÇO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("a busca guarda o objeto no caminho derivado da org e da chamada", async () => {
  await installSigner();
  const store = fakeStore();
  const { fn, seen } = fakeFetch([{ status: 200, body: OGG }]);

  const out = await fetchAndStoreRecording(store.db, ARGS, { fetch: fn });

  assert(out.ok, `busca falhou: ${!out.ok ? out.reason : ""}`);
  assertEquals(out.path, `${ORG}/${CALL_ID}.opus`);
  assertEquals(out.path, recordingObjectPath(ORG, CALL_ID));

  assertEquals(store.uploads.length, 1);
  assertEquals(store.uploads[0].bucket, "call-recordings");
  assertEquals(store.uploads[0].path, `${ORG}/${CALL_ID}.opus`);
  assertEquals(store.uploads[0].contentType, "audio/ogg");
  assertEquals(store.uploads[0].bytes, OGG.byteLength);

  // O endereço é registrado pela função de banco, com o MESMO caminho — é ela
  // que recompõe a partir da linha e recusa se divergir.
  const stored = store.rpcs.find((c) => c.fn === "fn_voip_recording_stored");
  assert(stored, "fn_voip_recording_stored não foi chamada");
  assertEquals(stored.args.p_call_id, CALL_ID);
  assertEquals(stored.args.p_path, `${ORG}/${CALL_ID}.opus`);
  assertEquals(stored.args.p_bytes, OGG.byteLength);

  // A rota da VPS carrega a SESSÃO e o id de rede da chamada (`tc_call_id`),
  // não o id do ledger do CRM: são identificadores de mundos diferentes, e
  // trocá-los daria 404 em toda gravação.
  assertEquals(seen.length, 1);
  assertEquals(
    seen[0].url,
    `http://vps.invalido/api/sessions/${SID}/calls/${TC_CALL}/recording`,
  );
  assert(seen[0].auth?.startsWith("Bearer "), "a busca foi sem credencial");
});

/** Lê as claims de um `Bearer <JWS>` sem verificar — o teste só quer olhar. */
function claimsOf(auth: string | null): Record<string, unknown> {
  const jws = (auth ?? "").replace(/^Bearer\s+/, "");
  const parte = jws.split(".")[1] ?? "";
  return JSON.parse(new TextDecoder().decode(bytesFromB64url(parte)));
}

Deno.test("o token cunhado NOMEIA a chamada que está sendo buscada", async () => {
  // O ACHADO DA REVISÃO, pelo lado do CRM. A VPS passou a exigir `cid` na
  // credencial (`callIDFor`), e sem ele toda busca tomaria 404 — o sintoma
  // apareceria como "a gravação nunca chega", que não aponta para o token.
  //
  // O `cid` é o id de rede da chamada (`tc_call_id`), NÃO o id do ledger do
  // CRM: é ele que a VPS conhece, e trocá-los daria 404 em toda gravação.
  await installSigner();
  const store = fakeStore();
  const { fn, seen } = fakeFetch([{ status: 200, body: OGG }, { status: 204 }]);

  await muteRuntimeLogs(() => runRecordingIngest(store.db, ARGS, { fetch: fn }));

  assertEquals(seen.length, 2, "esperado GET e DELETE");
  for (const req of seen) {
    const c = claimsOf(req.auth);
    assertEquals(c.cid, TC_CALL, `${req.method}: o token não nomeia a chamada`);
    assertEquals(c.sid, SID, `${req.method}: o token não nomeia a sessão`);
    assertEquals(c.org, ORG, `${req.method}: o token não nomeia a organização`);
    assertEquals(c.sc, "admin");
  }
  // LER e APAGAR continuam sendo atos SEPARADOS: o token da busca não apaga.
  assertEquals(claimsOf(seen[0].auth).act, ["recording.read"]);
  assertEquals(claimsOf(seen[1].auth).act, ["recording.delete"]);
});

Deno.test("cunhar credencial de gravação sem chamada é recusado no assinador", async () => {
  // Fail-closed com a causa nomeada. Um token sem `cid` seria recusado lá na
  // VPS com 404 — indistinguível de "a gravação não existe", que é o
  // diagnóstico errado e manda olhar o lugar errado.
  await installSigner();
  const { signAdminToken } = await import("./tokens.ts");
  for (const act of ["recording.read", "recording.delete"] as const) {
    let estourou = false;
    try {
      await signAdminToken({ act, org: ORG, sid: SID, sub: "teste" });
    } catch (e) {
      estourou = true;
      assert(
        String(e).includes("cid"),
        `${act}: a mensagem não nomeia a causa: ${e}`,
      );
    }
    assert(estourou, `${act} foi cunhado sem cid`);
  }
});

Deno.test("a gravação de outra organização não alcança este caminho", async () => {
  // O caminho é DERIVADO da organização que a RPC resolveu pela sessão. Duas
  // organizações produzem dois prefixos distintos, e a policy do bucket lê
  // justamente o primeiro segmento para decidir quem ouve.
  await installSigner();
  const outraOrg = "00000000-0000-4000-8000-000000000abc";
  const store = fakeStore();
  const { fn } = fakeFetch([{ status: 200, body: OGG }]);

  await fetchAndStoreRecording(
    store.db,
    { ...ARGS, organizationId: outraOrg },
    { fetch: fn },
  );

  assertEquals(store.uploads[0].path, `${outraOrg}/${CALL_ID}.opus`);
  assert(
    !store.uploads[0].path.startsWith(ORG),
    "o objeto foi parar debaixo da pasta da organização errada",
  );
});

Deno.test("subir de novo o mesmo caminho é sobrescrita, nunca uma segunda cópia", async () => {
  // O caminho é determinístico: uma chamada, uma gravação. `upsert` é o que
  // impede a segunda entrega de virar conflito, e o que impede duas cópias do
  // mesmo áudio ocupando o bucket.
  await installSigner();
  const store = fakeStore();
  const { fn } = fakeFetch([{ status: 200, body: OGG }]);

  await fetchAndStoreRecording(store.db, ARGS, { fetch: fn });
  await fetchAndStoreRecording(store.db, ARGS, { fetch: fn });

  assertEquals(store.uploads[0].upsert, true);
  assertEquals(store.uploads[0].path, store.uploads[1].path);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FALHA SE DECLARA — NUNCA VIRA AUSÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("busca que falha registra `failed` com a causa, e não deixa em ausência", async () => {
  await installSigner();
  for (
    const caso of [
      { resposta: { status: 404 }, motivo: "vps_http_404" },
      { resposta: { status: 500 }, motivo: "vps_http_500" },
      { resposta: { status: 200, body: new Uint8Array(0) }, motivo: "empty_body" },
      {
        // 200 com HTML: a página de erro de um proxy. Sem a conferência do
        // cabeçalho Ogg, isto seria guardado como se fosse a conversa, e o
        // gestor descobriria ao dar play — semanas depois.
        resposta: { status: 200, body: new TextEncoder().encode("<html>502</html>") },
        motivo: "not_ogg",
      },
      {
        // Corpo cortado no meio do envio. Um opus truncado parece íntegro.
        resposta: {
          status: 200,
          body: OGG,
          headers: { "content-length": String(OGG.byteLength + 500) },
        },
        motivo: "truncated_body",
      },
    ]
  ) {
    const store = fakeStore();
    const { fn } = fakeFetch([caso.resposta]);

    const out = await muteRuntimeLogs(() =>
      runRecordingIngest(store.db, ARGS, { fetch: fn })
    );

    assert(!out.ok, `${caso.motivo}: a busca deveria ter falhado`);
    assertEquals(out.reason, caso.motivo);

    assertEquals(store.uploads.length, 0, `${caso.motivo}: subiu lixo para o bucket`);

    // Sem esta escrita o registro ficaria em `processing` para sempre — e
    // "processando há três dias" é a ausência disfarçada.
    const falhou = store.rpcs.find((c) => c.fn === "fn_voip_recording_fetch_failed");
    assert(falhou, `${caso.motivo}: a falha não foi registrada`);
    assertEquals(falhou.args.p_call_id, CALL_ID);
    assertEquals(falhou.args.p_reason, caso.motivo);

    // A DIFERENÇA QUE IMPEDE O LAÇO (S4, #1360): quem declara a falha da BUSCA
    // é `fn_voip_recording_fetch_failed`, que reenfileira com teto.
    // `fn_voip_recording_failed` é a VPS avisando que arquivo não haverá — e
    // essa NÃO volta para a fila. Trocar uma pela outra aqui faria o CRM buscar
    // de novo, quatro vezes, um arquivo que o dono já disse que não existe.
    assert(
      !store.rpcs.some((c) => c.fn === "fn_voip_recording_failed"),
      `${caso.motivo}: usou a função da falha ANUNCIADA no caminho da BUSCA`,
    );

    assert(
      !store.rpcs.some((c) => c.fn === "fn_voip_recording_stored"),
      `${caso.motivo}: declarou a gravação pronta`,
    );
  }
});

Deno.test("corpo acima do teto é recusado antes de virar objeto", async () => {
  // O gravador da VPS corta em 64 MiB. Corpo maior é sinal de que quem
  // respondeu não foi a VPS — e um teto aqui é o que impede a memória do
  // isolate de virar o alvo.
  await installSigner();
  const store = fakeStore();
  const gigante = new Uint8Array(MAX_RECORDING_BYTES + 1);
  gigante.set(OGG.slice(0, 4), 0);
  const { fn } = fakeFetch([{ status: 200, body: gigante }]);

  const out = await muteRuntimeLogs(() =>
    runRecordingIngest(store.db, ARGS, { fetch: fn })
  );

  assert(!out.ok);
  assertEquals(out.reason, "too_large");
  assertEquals(store.uploads.length, 0);
});

Deno.test("upload que falha marca falha e NÃO declara a gravação pronta", async () => {
  await installSigner();
  const store = fakeStore({}, { uploadError: { message: "bucket cheio" } });
  const { fn } = fakeFetch([{ status: 200, body: OGG }]);

  const out = await muteRuntimeLogs(() =>
    runRecordingIngest(store.db, ARGS, { fetch: fn })
  );

  assert(!out.ok);
  assertEquals(out.reason, "storage_upload_failed");
  assert(!store.rpcs.some((c) => c.fn === "fn_voip_recording_stored"));
  assert(store.rpcs.some((c) => c.fn === "fn_voip_recording_fetch_failed"));
});

Deno.test("banco que recusa o caminho não vira gravação pronta", async () => {
  // `path_mismatch`: o objeto foi parar num lugar que a policy não deixa
  // ninguém ler. Declarar `ready` sobre isso seria prometer um áudio que não
  // toca para ninguém.
  await installSigner();
  const store = fakeStore({ fn_voip_recording_stored: "path_mismatch" });
  const { fn } = fakeFetch([{ status: 200, body: OGG }]);

  const out = await muteRuntimeLogs(() =>
    runRecordingIngest(store.db, ARGS, { fetch: fn })
  );

  assert(!out.ok);
  assertEquals(out.reason, "db_path_mismatch");
  assert(
    store.rpcs.some((c) => c.fn === "fn_voip_recording_fetch_failed"),
    "recusa do banco não virou falha registrada",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A ORDEM: A CÓPIA DA VPS SÓ MORRE DEPOIS DE O ENDEREÇO ESTAR GRAVADO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("a limpeza da VPS acontece DEPOIS de `stored`", async () => {
  await installSigner();
  const store = fakeStore();
  const { fn, seen } = fakeFetch([{ status: 200, body: OGG }, { status: 204 }]);

  await muteRuntimeLogs(() => runRecordingIngest(store.db, ARGS, { fetch: fn }));

  assertEquals(seen.map((s) => s.method), ["GET", "DELETE"]);
  assert(
    store.rpcs.some((c) => c.fn === "fn_voip_recording_stored"),
    "a gravação não foi declarada pronta",
  );
});

Deno.test("busca que falha NÃO apaga a cópia da VPS", async () => {
  // Se a busca falhou, a VPS é a única que ainda tem o arquivo. Apagá-lo aqui
  // tornaria a falha irreversível.
  await installSigner();
  const store = fakeStore();
  const { fn, seen } = fakeFetch([{ status: 500 }]);

  await muteRuntimeLogs(() => runRecordingIngest(store.db, ARGS, { fetch: fn }));

  assert(
    !seen.some((s) => s.method === "DELETE"),
    "apagou da VPS a única cópia de uma gravação que não conseguiu guardar",
  );
});

Deno.test("upload que falha NÃO apaga a cópia da VPS", async () => {
  await installSigner();
  const store = fakeStore({}, { uploadError: { message: "bucket cheio" } });
  const { fn, seen } = fakeFetch([{ status: 200, body: OGG }, { status: 204 }]);

  await muteRuntimeLogs(() => runRecordingIngest(store.db, ARGS, { fetch: fn }));

  assert(
    !seen.some((s) => s.method === "DELETE"),
    "apagou da VPS o áudio que não conseguiu guardar no bucket",
  );
});
