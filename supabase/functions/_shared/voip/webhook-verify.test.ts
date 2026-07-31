/**
 * Testes do verificador de envelope do webhook da VPS.
 *
 * Duas famílias, e elas respondem a perguntas diferentes:
 *
 *   1. ENVELOPE — um token bom passa, e cada campo adulterado é recusado.
 *   2. CARGA DA CHAVE — configuração ruim faz a função RECUSAR SERVIR, em vez
 *      de servir com uma chave que aceita qualquer coisa.
 *
 * A segunda família é a que justifica o desenho. Os números que aparecem nela
 * (probe #7, 29% de acerto) não são chute: estão medidos em `deno 2.7.7`, e a
 * medição está no relatório da tarefa.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __resetWebhookKeysForTests,
  verifyWebhook,
  verifyWebhookDetailed,
} from "./webhook-verify.ts";

// ─── utilitários ────────────────────────────────────────────────────────────

/** Ver a nota do mesmo apelido em webhook-verify.ts: TS 5.7 + WebCrypto. */
type Bytes = Uint8Array<ArrayBuffer>;

const AUD = "torquecrm-webhook.test";
const ENV = "test";
const BODY = '{"type":"call-status","id":"tc-call-1","status":"connected"}';

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

function bytesFromHex(hex: string): Bytes {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

interface Pair {
  priv: CryptoKey;
  pub: Bytes;
  kid: string;
  /** O valor pronto para TORQUECALLS_WEBHOOK_PUBKEY, como o Go o imprime. */
  entry: string;
}

/** Espelha `webhookKID` do Go: 8 primeiros hex do SHA-256 da pública. */
async function kidOf(pub: Bytes): Promise<string> {
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", pub));
  return [...sum.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makePair(): Promise<Pair> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const pub = bytesFromB64url(jwk.x!);
  const kid = await kidOf(pub);
  return { priv: kp.privateKey, pub, kid, entry: `${kid}:${b64urlFromBytes(pub)}` };
}

/** Instala o ambiente e descarta o cache — a carga refaz o auto-teste. */
function install(pubkeyEnv: string, aud = AUD, env = ENV): void {
  Deno.env.set("TORQUECALLS_WEBHOOK_PUBKEY", pubkeyEnv);
  Deno.env.set("TORQUECALLS_WEBHOOK_AUDIENCE", aud);
  Deno.env.set("TORQUECALLS_ENV", env);
  __resetWebhookKeysForTests();
}

/**
 * Monta o JWS exatamente como `signWebhook` do Go monta — inclusive o `bh`
 * sobre os bytes CRUS do corpo. Se este helper divergir do Go, os testes ficam
 * verdes contra um contrato que não existe; por isso ele é uma tradução linha a
 * linha de `cmd/server/webhooksign.go`, não uma reinvenção.
 */
async function signEnvelope(opts: {
  priv: CryptoKey;
  kid: string;
  body?: string;
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  /** Assinatura crua, para forjar sem chave. */
  rawSignature?: Bytes;
}): Promise<string> {
  const body = opts.body ?? BODY;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const iat = Math.floor(Date.now() / 1000);

  const header = { alg: "EdDSA", typ: "JWT", kid: opts.kid, ...opts.header };
  const payload = {
    iss: "torquecalls-vps",
    aud: AUD,
    env: ENV,
    iat,
    exp: iat + 300,
    jti: crypto.randomUUID(),
    sid: "tc-sessao-1",
    bh: b64urlFromBytes(digest),
    epoch: 3,
    seq: 42,
    ...opts.claims,
  };

  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${
    b64urlFromString(JSON.stringify(payload))
  }`;
  const sig = opts.rawSignature ?? new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      opts.priv,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64urlFromBytes(sig)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. ENVELOPE
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("envelope íntegro devolve as claims que a T8 precisa", async () => {
  const k = await makePair();
  install(k.entry);

  const token = await signEnvelope({ priv: k.priv, kid: k.kid });
  const claims = await verifyWebhook(token, BODY);

  assert(claims, "o envelope da própria chave configurada tem que passar");
  assertEquals(claims.iss, "torquecalls-vps");
  assertEquals(claims.sid, "tc-sessao-1");
  assertEquals(claims.epoch, 3);
  assertEquals(claims.seq, 42);
  assertEquals(claims.aud, AUD);
  assertEquals(claims.env, ENV);
  assert(claims.jti.length > 0);
  // `iat` vira p_signed_at na RPC da T6.
  assert(Number.isSafeInteger(claims.iat));
});

Deno.test("o header Authorization inteiro também é aceito — 'Bearer ' não vira 401 mudo", async () => {
  const k = await makePair();
  install(k.entry);

  const token = await signEnvelope({ priv: k.priv, kid: k.kid });
  assert(await verifyWebhook(`Bearer ${token}`, BODY));
  assert(await verifyWebhook(`bearer ${token}`, BODY));
});

Deno.test("corpo ALTERADO é recusado — é o bh fazendo efeito", async () => {
  const k = await makePair();
  install(k.entry);

  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: BODY });
  const adulterado = BODY.replace('"connected"', '"ended"');

  assertEquals(await verifyWebhook(token, adulterado), null);
  const r = await verifyWebhookDetailed(token, adulterado);
  assertEquals(r.ok, false);
  assertEquals(r.ok === false ? r.reason : null, "body_hash_mismatch");
});

Deno.test("REserializar o JSON quebra tudo — o corpo tem que ser o cru", async () => {
  // Este teste existe por causa do sintoma: reserializar não muda o SENTIDO do
  // corpo, só a ordem das chaves e o espaço em branco. O hash muda, todo
  // webhook é recusado, e o sintoma aparece como "o CRM ignora os eventos" —
  // que não aponta para cá. Se alguém trocar req.text() por req.json() na T8,
  // é esta asserção que explica o que aconteceu.
  const k = await makePair();
  install(k.entry);

  const cru = '{ "type":"call-ended",  "id":"tc-call-1" }';
  const token = await signEnvelope({ priv: k.priv, kid: k.kid, body: cru });

  assert(await verifyWebhook(token, cru), "o corpo cru passa");

  const reserializado = JSON.stringify(JSON.parse(cru));
  assertNotEquals(reserializado, cru);
  assertEquals(
    await verifyWebhook(token, reserializado),
    null,
    "reserializar tem que ser recusado, não tolerado",
  );
});

Deno.test("assinatura de OUTRA chave é recusada, mesmo com o kid certo", async () => {
  const boa = await makePair();
  const intrusa = await makePair();
  install(boa.entry);

  // Mesmo kid declarado no header, assinatura da chave errada.
  const token = await signEnvelope({ priv: intrusa.priv, kid: boa.kid });
  assertEquals(await verifyWebhook(token, BODY), null);
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "bad_signature");
});

Deno.test("kid desconhecido é recusado antes de qualquer verificação", async () => {
  const boa = await makePair();
  const outra = await makePair();
  install(boa.entry);

  const token = await signEnvelope({ priv: outra.priv, kid: outra.kid });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "unknown_kid");
});

Deno.test("exp no passado é recusado", async () => {
  const k = await makePair();
  install(k.entry);

  const iat = Math.floor(Date.now() / 1000) - 3600;
  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { iat, exp: iat + 300 },
  });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "expired");
});

Deno.test("envelope recém-expirado ainda passa dentro da tolerância de relógio", async () => {
  const k = await makePair();
  install(k.entry);

  // 10 s depois do exp. O Go tolera 30 s no sentido inverso (token.go:105) e
  // relógio de VPS não é atômico — recusar aqui seria inventar incidente.
  const now = Math.floor(Date.now() / 1000);
  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { iat: now - 310, exp: now - 10 },
  });
  assert(await verifyWebhook(token, BODY));
});

Deno.test("envelope do futuro além da tolerância é recusado", async () => {
  const k = await makePair();
  install(k.entry);

  const iat = Math.floor(Date.now() / 1000) + 600;
  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { iat, exp: iat + 300 },
  });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "not_yet_valid");
});

Deno.test("vida útil maior que a do contrato é recusada", async () => {
  const k = await makePair();
  install(k.entry);

  const iat = Math.floor(Date.now() / 1000);
  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { iat, exp: iat + 86400 },
  });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "ttl_too_long");
});

Deno.test("aud de outro destino é recusado", async () => {
  const k = await makePair();
  install(k.entry);

  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { aud: "outro-crm.exemplo" },
  });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "wrong_audience");
});

Deno.test("env de dev não escreve em prod", async () => {
  const k = await makePair();
  install(k.entry, AUD, "prod");

  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { env: "dev" },
  });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "wrong_env");
});

Deno.test("credencial do SENTIDO OPOSTO não entra por aqui", async () => {
  // O CRM assina com iss='torque-crm' e manda para a VPS; a VPS assina com
  // iss='torquecalls-vps' e manda para cá. No dia em que alguém colar a chave
  // errada no segredo errado, é este `iss` que impede um tc-stream — que CHEGA
  // AO NAVEGADOR — de virar evento de webhook.
  const k = await makePair();
  install(k.entry);

  const token = await signEnvelope({
    priv: k.priv,
    kid: k.kid,
    claims: { iss: "torque-crm" },
  });
  const r = await verifyWebhookDetailed(token, BODY);
  assertEquals(r.ok === false ? r.reason : null, "wrong_issuer");
});

Deno.test("alg fora de EdDSA é recusado, mesmo com assinatura boa", async () => {
  const k = await makePair();
  install(k.entry);

  for (const alg of ["none", "HS256", "RS256", "ed25519"]) {
    const token = await signEnvelope({ priv: k.priv, kid: k.kid, header: { alg } });
    const r = await verifyWebhookDetailed(token, BODY);
    assertEquals(
      r.ok === false ? r.reason : null,
      "bad_header",
      `alg=${alg} deveria ser recusado`,
    );
  }
});

Deno.test("claim estrutural inválida é recusada", async () => {
  const k = await makePair();
  install(k.entry);

  const casos: Array<[string, Record<string, unknown>]> = [
    ["sid vazio", { sid: "" }],
    ["sid não-string", { sid: 7 }],
    ["jti vazio", { jti: "" }],
    ["seq como string", { seq: "42" }],
    ["seq fracionário", { seq: 1.5 }],
    ["epoch negativo", { epoch: -1 }],
    ["iat não-numérico", { iat: "agora" }],
    ["bh ausente", { bh: undefined }],
  ];

  for (const [nome, claims] of casos) {
    const token = await signEnvelope({ priv: k.priv, kid: k.kid, claims });
    assertEquals(await verifyWebhook(token, BODY), null, `${nome} deveria ser recusado`);
  }
});

Deno.test("credencial AUSENTE é 401, não 500 — o tipo não protege esta linha", async () => {
  // `req.headers.get("Authorization")` devolve `string | null`, e requisição sem
  // Authorization é o caso mais comum que existe: varredura de porta, health
  // check, chamada malfeita. Se isso estourar TypeError, a T8 responde 500 onde
  // devia responder 401 — e some a distinção "config quebrada" × "token ruim",
  // que é o motivo de este módulo separar `throw` de `null`.
  //
  // O compilador NÃO pega: este arquivo está fora do `deno check` do choke e
  // `deno task test` roda com `--no-check`.
  const k = await makePair();
  install(k.entry);

  const naoStrings: unknown[] = [null, undefined, 42, {}, [], true];
  for (const v of naoStrings) {
    const t = v as unknown as string;

    assertEquals(
      await verifyWebhook(t, BODY),
      null,
      `token ${String(v)} devia recusar limpo, não estourar`,
    );
    const r = await verifyWebhookDetailed(t, BODY);
    assertEquals(r.ok === false ? r.reason : null, "malformed");

    // O corpo tem o mesmo problema, com um sintoma PIOR — e por isso aqui se
    // afere o MOTIVO, não só o `null`. Sem guarda, `TextEncoder().encode(null)`
    // não estoura: ele hasheia a string "null" como se fosse o corpo, e a
    // recusa sai como `body_hash_mismatch`. Aí manda o operador caçar defeito
    // de serialização do payload quando o problema é que o chamador não passou
    // um corpo. Recusar por `null` só, sem olhar o motivo, deixaria essa troca
    // de diagnóstico passar despercebida.
    const rb = await verifyWebhookDetailed(
      await signEnvelope({ priv: k.priv, kid: k.kid }),
      t,
    );
    assertEquals(
      rb.ok === false ? rb.reason : null,
      "malformed",
      `corpo ${String(v)} devia dizer 'malformed', não culpar o hash do corpo`,
    );
  }
});

Deno.test("token malformado é recusado sem estourar", async () => {
  const k = await makePair();
  install(k.entry);

  const bom = await signEnvelope({ priv: k.priv, kid: k.kid });
  const [h, p, s] = bom.split(".");

  const malformados = [
    "",
    "   ",
    "abc",
    `${h}.${p}`,
    `${h}.${p}.${s}.extra`,
    `${h}..${s}`,
    `..`,
    // base64 PADRÃO em vez de base64url: o Go emite RawURLEncoding, e aceitar
    // as duas formas abriria um segundo jeito de codificar o mesmo token.
    `${h}.${p}.${s.replace(/-/g, "+").replace(/_/g, "/")}=`,
    `${h}.${p}.${s}!`,
    // header que não é objeto
    `${b64urlFromString("[1,2,3]")}.${p}.${s}`,
    `${b64urlFromString("nao é json")}.${p}.${s}`,
  ];

  for (const t of malformados) {
    assertEquals(await verifyWebhook(t, BODY), null, `token ${JSON.stringify(t)} passou`);
  }
});

Deno.test("payload que não é objeto JSON é recusado", async () => {
  const k = await makePair();
  install(k.entry);

  const header = b64urlFromString(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: k.kid }));
  const payload = b64urlFromString('"só uma string"');
  const signingInput = `${header}.${payload}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      k.priv,
      new TextEncoder().encode(signingInput),
    ),
  );
  const token = `${signingInput}.${b64urlFromBytes(sig)}`;

  assertEquals(await verifyWebhook(token, BODY), null);
});

Deno.test("rotação: duas chaves vivas, e as duas verificam", async () => {
  const velha = await makePair();
  const nova = await makePair();
  install(`${velha.entry}, ${nova.entry}`);

  assert(
    await verifyWebhook(await signEnvelope({ priv: velha.priv, kid: velha.kid }), BODY),
    "a chave antiga tem que seguir verificando durante a rotação",
  );
  assert(
    await verifyWebhook(await signEnvelope({ priv: nova.priv, kid: nova.kid }), BODY),
    "a chave nova tem que verificar",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 1b. CONTRATO CONTRA A VPS DE VERDADE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envelope emitido pelo `signWebhook` do Go, com `CallRecord` real e semente
 * fixa (`4a1f7c…9d63`). Congelado em 2026-07-31 rodando `go test` no repositório
 * `tc-s5`, branch `feat/s11-webhook`.
 *
 * Existe porque todo o resto desta suíte usa um assinador escrito EM TypeScript,
 * traduzido do Go. Uma tradução com o mesmo erro dos dois lados fica verde
 * contra um contrato que não existe. Estes bytes vieram da implementação que vai
 * rodar na VPS.
 */
const GO_FIXTURE = {
  pubkeyEnv: "5144b2c9:oONeilZeyLnz0C7zf1wj9XaMnxsAmCw6vqjQQvUoOjc",
  body:
    '{"sessionId":"tc-sessao-real","callId":"tc-call-9","owner":"11111111-1111-1111-1111-111111111111","direction":"outbound","peer":"554891005289","startedAt":1753900000000,"status":"connected"}',
  token:
    "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6IjUxNDRiMmM5In0.eyJpc3MiOiJ0b3JxdWVjYWxscy12cHMiLCJhdWQiOiJ0b3JxdWVjcm0td2ViaG9vay50ZXN0IiwiZW52IjoidGVzdCIsImlhdCI6MTc1MzkwMDEyMywiZXhwIjoxNzUzOTAwNDIzLCJqdGkiOiI1OTBiMTQwMi03MzZhLTQ5ZGEtYTJmNC04YmExN2M1ZmJiOTQiLCJzaWQiOiJ0Yy1zZXNzYW8tcmVhbCIsImJoIjoidkx0a3JoZ0F1Z3JibHpvaGlSQVFZR3l2TU12ZGsyckJreXQzSGJqT19rcyIsImVwb2NoIjo3LCJzZXEiOjEzfQ.qKZjpk7frguzxMPrBnLJ_0sCN-Oe6ArwMXp6Mv8_gFmk_-Y8W2_S0hU1BQmXYOpfnypmU2L8jvxRRX-ihEGUBw",
} as const;

Deno.test("envelope REAL do Go passa por tudo menos o relógio", async () => {
  install(GO_FIXTURE.pubkeyEnv);

  const r = await verifyWebhookDetailed(GO_FIXTURE.token, GO_FIXTURE.body);

  // `expired` é o veredito mais informativo que este fixture consegue dar: a
  // recusa por relógio vem DEPOIS de kid, assinatura, iss, aud, env e vida útil.
  // Qualquer deriva de contrato — outro alg, outro iss, base64 com padding,
  // ordem do signing input — apareceria aqui como outro motivo.
  assertEquals(
    r.ok === false ? r.reason : "PASSOU",
    "expired",
    "o envelope real do Go tem que chegar íntegro até a checagem de relógio",
  );
});

Deno.test("o bh do Go bate com o SHA-256 do corpo real", async () => {
  // O `bh` não é alcançado pelo teste acima (o relógio recusa antes), então ele
  // é conferido aqui, direto contra os bytes que o Go emitiu.
  const claims = JSON.parse(
    new TextDecoder().decode(bytesFromB64url(GO_FIXTURE.token.split(".")[1])),
  );
  const digest = b64urlFromBytes(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(GO_FIXTURE.body)),
    ),
  );
  assertEquals(digest, claims.bh);
});

Deno.test("no payload REAL, reserializar MUDA os bytes — a armadilha da T8 é concreta", () => {
  // O corpo do webhook vem de uma STRUCT do Go (`CallRecord`), serializada na
  // ordem de declaração dos campos: sessionId, callId, owner, direction, ...
  // `JSON.stringify` do JS preserva a ordem de inserção do parse, mas qualquer
  // normalização (ou um map do Go, que sai alfabético) reordena.
  //
  // Este teste existe porque um smoke test feito à mão com payload simples pode
  // passar e esconder o defeito: é preciso um corpo com ordem NÃO alfabética
  // para o erro aparecer — e é exatamente esse o corpo de produção.
  const chaves = Object.keys(JSON.parse(GO_FIXTURE.body));
  const alfabetica = [...chaves].sort();
  assertNotEquals(
    chaves.join(","),
    alfabetica.join(","),
    "se o payload real virasse alfabético, este alerta perde a força — reveja",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CARGA DA CHAVE — o auto-teste
// ═══════════════════════════════════════════════════════════════════════════

/**
 * As 8 codificações do subgrupo de torção que o verificador do Deno realmente
 * decodifica. Contra qualquer uma delas existe assinatura que vale para
 * QUALQUER corpo — é o defeito que "validar por tamanho" não pega.
 *
 * As outras 6 codificações conhecidas (`01…80`, `ec…ff`, `ed…7f`, `ed…ff`,
 * `ee…7f`, `ee…ff`) foram medidas em 0/200: o próprio decodificador de ponto do
 * Deno as rejeita, então elas nunca verificam nada e são inertes.
 */
const ORDEM_PEQUENA: Array<[string, string]> = [
  ["ordem 4 (00 × 32)", "00".repeat(32)],
  ["ordem 4, bit de sinal", "0000000000000000000000000000000000000000000000000000000000000080"],
  ["identidade", "01" + "00".repeat(31)],
  ["ordem 8 (a)", "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05"],
  ["ordem 8 (a')", "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85"],
  ["ordem 8 (b)", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"],
  ["ordem 8 (b')", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa"],
  ["ordem 2 (p-1)", "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"],
];

Deno.test("chave de ordem pequena faz a função RECUSAR SERVIR", async () => {
  for (const [nome, hex] of ORDEM_PEQUENA) {
    const pub = bytesFromHex(hex);
    install(`${await kidOf(pub)}:${b64urlFromBytes(pub)}`);

    await assertRejects(
      () => verifyWebhook("qualquer.coisa.aqui", BODY),
      Error,
      "auto-teste",
      `${nome} deveria ser recusada na carga`,
    );
  }
});

Deno.test("UM fixture só NÃO pegaria a chave de ordem 4 — por isso o auto-teste é bateria", async () => {
  // Medido em deno 2.7.7: contra a chave `00 × 32`, a assinatura neutra
  // (R = ponto-base, S = 1) vale para ~29% das mensagens, e o primeiro acerto
  // com a sequência de sondas deste módulo só aparece na sonda #7.
  //
  // Ou seja: o "um fixture bom, um ruim" do enunciado teria ficado VERDE com
  // uma chave que aceita evento forjado de qualquer sessão. Esta asserção é o
  // motivo de o auto-teste rodar uma bateria, e ela quebra se alguém "otimizar"
  // o mecanismo de volta para uma sonda só.
  const pub = bytesFromHex("00".repeat(32));
  const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, [
    "verify",
  ]);
  const forjada = bytesFromHex(
    "5866666666666666666666666666666666666666666666666666666666666666" +
      "01" + "00".repeat(31),
  );
  const sonda = (i: number) =>
    new TextEncoder().encode(`torquecalls/webhook-verify/auto-teste/${i}`);

  assertEquals(
    await crypto.subtle.verify({ name: "Ed25519" }, key, forjada, sonda(0)),
    false,
    "se a sonda #0 já pegasse, este teste perdeu o sentido — reveja a bateria",
  );

  let pegou = false;
  for (let i = 0; i < 64 && !pegou; i++) {
    pegou = await crypto.subtle.verify({ name: "Ed25519" }, key, forjada, sonda(i));
  }
  assert(pegou, "a bateria tem que pegar a chave de ordem 4 em algum ponto");
});

Deno.test("a chave de EXEMPLO do RFC 8032 recusa servir — a privada dela é pública", async () => {
  // Terceira perna do auto-teste, sozinha.
  //
  // Esta chave é um ponto de ordem NORMAL: a bateria de sondas dá 0 acertos e
  // ela passa batido pelas duas primeiras pernas. O tamanho está certo, o kid
  // deriva certo, ela importa certo. Só que a privada correspondente
  // (`9d61b19d…`) está impressa no RFC e em todo tutorial de Ed25519 — qualquer
  // um assinaria evento para qualquer sessão.
  //
  // É um copiar-colar plausível: são os bytes que aparecem primeiro para quem
  // abre um exemplo "só para testar se funciona" e esquece de trocar.
  const pub = bytesFromHex(
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  );
  install(`${await kidOf(pub)}:${b64urlFromBytes(pub)}`);

  await assertRejects(
    () => verifyWebhook("a.b.c", BODY),
    Error,
    "RFC 8032",
    "a chave de exemplo do RFC tem que ser recusada na carga",
  );
});

Deno.test("chave legítima NUNCA cai no auto-teste — o gate não pode ser flaky", async () => {
  // Falso positivo aqui derrubaria o webhook de produção num deploy qualquer,
  // sem nada no código ter mudado. 24 pares novos a cada rodada.
  for (let i = 0; i < 24; i++) {
    const k = await makePair();
    install(k.entry);
    assert(
      await verifyWebhook(await signEnvelope({ priv: k.priv, kid: k.kid }), BODY),
      "chave legítima reprovada no auto-teste",
    );
  }
});

/**
 * Troca `crypto.subtle.verify` por um dublê e devolve tudo ao lugar no fim.
 *
 * É a única forma de exercer a perna "runtime sem Ed25519" do auto-teste: não
 * dá para desinstalar a curva do Deno, e sem simular isso a checagem do vetor
 * do RFC 8032 seria uma linha que ninguém nunca viu funcionar.
 */
async function comVerifyDublê(fixo: boolean, corpo: () => Promise<void>): Promise<void> {
  const original = crypto.subtle.verify;
  // deno-lint-ignore no-explicit-any
  (crypto.subtle as any).verify = () => Promise.resolve(fixo);
  try {
    await corpo();
  } finally {
    // deno-lint-ignore no-explicit-any
    (crypto.subtle as any).verify = original;
  }
}

Deno.test("runtime que não faz Ed25519 recusa servir, e diz isso", async () => {
  const k = await makePair();

  // (a) verify sempre false — é como um runtime sem a curva se comporta. Sem o
  //     vetor conhecido, TODAS as outras checagens do auto-teste continuariam
  //     passando (elas esperam false!) e a função subiria para recusar 100% dos
  //     webhooks em silêncio, para sempre.
  await comVerifyDublê(false, async () => {
    install(k.entry);
    await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "RFC 8032");
  });

  // (b) verify sempre true — o oposto, e o pior dos dois: aceitaria qualquer
  //     envelope de qualquer um.
  await comVerifyDublê(true, async () => {
    install(k.entry);
    await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "auto-teste");
  });

  // O dublê saiu de cena: a chave boa volta a funcionar.
  install(k.entry);
  assert(await verifyWebhook(await signEnvelope({ priv: k.priv, kid: k.kid }), BODY));
});

Deno.test("chave TRUNCADA é recusada — o importKey do Deno aceita qualquer tamanho", async () => {
  // Medido: importKey("raw", ...) aceitou 0, 1, 31, 33 e 64 bytes sem reclamar,
  // e o verify daí em diante só devolve false. Sem esta checagem, um segredo
  // cortado no copia-e-cola vira "o CRM ignora todos os eventos", para sempre,
  // sem uma linha de erro em lugar nenhum.
  for (const n of [0, 16, 31, 33, 64]) {
    const pub = new Uint8Array(n).fill(0xab);
    install(`deadbeef:${b64urlFromBytes(pub)}`);
    await assertRejects(
      () => verifyWebhook("a.b.c", BODY),
      Error,
      "32 bytes",
      `chave de ${n} bytes deveria ser recusada`,
    );
  }
});

Deno.test("kid que não casa com a chave é recusado — entrada trocada na rotação", async () => {
  const a = await makePair();
  const b = await makePair();
  // kid de uma chave, bytes da outra: o erro clássico de rotação a quatro mãos.
  install(`${a.kid}:${b64urlFromBytes(b.pub)}`);

  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "kid");
});

Deno.test("configuração ausente ou vazia recusa servir, nunca serve aberto", async () => {
  const k = await makePair();

  install(k.entry);
  Deno.env.delete("TORQUECALLS_WEBHOOK_PUBKEY");
  __resetWebhookKeysForTests();
  await assertRejects(
    () => verifyWebhook("a.b.c", BODY),
    Error,
    "TORQUECALLS_WEBHOOK_PUBKEY",
  );

  install(k.entry);
  Deno.env.delete("TORQUECALLS_WEBHOOK_AUDIENCE");
  __resetWebhookKeysForTests();
  await assertRejects(
    () => verifyWebhook("a.b.c", BODY),
    Error,
    "TORQUECALLS_WEBHOOK_AUDIENCE",
  );

  install(k.entry);
  Deno.env.delete("TORQUECALLS_ENV");
  __resetWebhookKeysForTests();
  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "TORQUECALLS_ENV");

  // Só separadores: passa do "ausente" e chega na carga sem produzir chave
  // nenhuma. Sem esta guarda, um segredo assim daria um chaveiro VAZIO, e
  // chaveiro vazio recusa tudo em silêncio em vez de acusar a configuração.
  install(",, ,");
  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "nenhuma chave");

  install("semdoisPontos");
  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "kid:base64url");

  install(`${k.kid}:não@é@base64url`);
  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "base64url");
});

Deno.test("kid repetido com chaves diferentes recusa servir", async () => {
  const a = await makePair();
  const b = await makePair();
  // Se passasse, qual das duas verificaria seria decidido por ordem de leitura —
  // e metade dos eventos cairia sem explicação.
  install(`${a.entry},${a.kid}:${b64urlFromBytes(b.pub)}`);

  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error);
});

Deno.test("mais de duas chaves recusa servir — rotação tem duas pontas, não uma multidão", async () => {
  const a = await makePair();
  const b = await makePair();
  const c = await makePair();
  install(`${a.entry},${b.entry},${c.entry}`);

  await assertRejects(() => verifyWebhook("a.b.c", BODY), Error, "duas");
});
