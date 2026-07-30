import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __resetKeyCacheForTests,
  publicKeyBase64,
  signAdminToken,
  signCallToken,
  signStreamToken,
} from "./sign.ts";

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function installKey(): Promise<void> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

  const combined = new Uint8Array(64);
  combined.set(b64urlToBytes(jwk.d!), 0);
  combined.set(b64urlToBytes(jwk.x!), 32);

  let bin = "";
  for (const b of combined) bin += String.fromCharCode(b);

  Deno.env.set("TORQUECALLS_SIGNING_SK", btoa(bin));
  Deno.env.set("TORQUECALLS_AUDIENCE", "calls.torquecrm.com.br");
  Deno.env.set("TORQUECALLS_ENV", "test");
  Deno.env.delete("TORQUECALLS_SIGNING_KID");
  __resetKeyCacheForTests();
}

const ARGS = {
  act: ["call.start"],
  ttlSeconds: 15,
  org: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sub: "11111111-1111-1111-1111-111111111111",
  sid: "tc-sess",
  cid: "d1111111-1111-1111-1111-111111111111",
  peer: "554891005289",
};

Deno.test("o token assinado VERIFICA com a chave pública que o runbook publica", async () => {
  await installKey();

  const { token } = await signCallToken(ARGS);
  const [h, p, s] = token.split(".");

  const pub = await crypto.subtle.importKey(
    "raw",
    b64urlToBytes(publicKeyBase64()),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    pub,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );

  // Sem esta asserção, uma assinatura errada só apareceria como "a chamada não
  // completa" depois que a VPS recusasse tudo em silêncio.
  assert(valid, "a VPS recusaria este token: assinatura não confere");
});

Deno.test("assinatura adulterada não verifica", async () => {
  await installKey();

  const { token } = await signCallToken(ARGS);
  const [h, p, s] = token.split(".");

  const forged = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  forged.org = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const forgedPayload = btoa(JSON.stringify(forged))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const pub = await crypto.subtle.importKey(
    "raw",
    b64urlToBytes(publicKeyBase64()),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    pub,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${forgedPayload}`),
  );

  assertEquals(valid, false, "trocar a org no payload tem que quebrar a assinatura");
});

Deno.test("header traz alg EdDSA e kid, e o kid é configurável por ambiente", async () => {
  await installKey();

  const first = await signCallToken(ARGS);
  const header = JSON.parse(
    new TextDecoder().decode(b64urlToBytes(first.token.split(".")[0])),
  );
  assertEquals(header.alg, "EdDSA");
  assertEquals(header.typ, "JWT");
  assertEquals(header.kid, "tc1");

  Deno.env.set("TORQUECALLS_SIGNING_KID", "tc2");
  __resetKeyCacheForTests();

  const second = await signCallToken(ARGS);
  const header2 = JSON.parse(
    new TextDecoder().decode(b64urlToBytes(second.token.split(".")[0])),
  );
  // Dois kids vivos ao mesmo tempo é o que permite rotacionar sem janela cega.
  assertEquals(header2.kid, "tc2");
  Deno.env.delete("TORQUECALLS_SIGNING_KID");
});

Deno.test("sem chave, o assinador recusa em vez de emitir token inútil", async () => {
  Deno.env.delete("TORQUECALLS_SIGNING_SK");
  __resetKeyCacheForTests();

  await assertRejects(
    () => signCallToken(ARGS),
    Error,
    "TORQUECALLS_SIGNING_SK ausente",
  );
});

Deno.test("chave em formato errado é recusada com o tamanho no erro", async () => {
  // 32 bytes = só a seed. Falta a pública, e sem ela nem dá para importar a JWK.
  Deno.env.set("TORQUECALLS_SIGNING_SK", btoa("x".repeat(32)));
  Deno.env.set("TORQUECALLS_AUDIENCE", "calls.torquecrm.com.br");
  Deno.env.set("TORQUECALLS_ENV", "test");
  __resetKeyCacheForTests();

  await assertRejects(() => signCallToken(ARGS), Error, "32 bytes");
  assertThrows(() => publicKeyBase64(), Error, "formato inesperado");
});

Deno.test("aud e env são obrigatórios — token de dev não pode discar em prod", async () => {
  await installKey();
  Deno.env.delete("TORQUECALLS_AUDIENCE");

  await assertRejects(() => signCallToken(ARGS), Error, "TORQUECALLS_AUDIENCE ausente");

  Deno.env.set("TORQUECALLS_AUDIENCE", "calls.torquecrm.com.br");
  Deno.env.delete("TORQUECALLS_ENV");
  await assertRejects(() => signCallToken(ARGS), Error, "TORQUECALLS_ENV ausente");
  Deno.env.set("TORQUECALLS_ENV", "test");
});

// ─── tc-admin ───────────────────────────────────────────────────────────────

Deno.test("tc-admin vive 30s, carrega uma ação só e nunca escopo call", async () => {
  await installKey();

  const t = await signAdminToken({
    act: "session.create",
    org: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sub: "11111111-1111-1111-1111-111111111111",
  });
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(t.token.split(".")[1])));

  assertEquals(c.sc, "admin");
  assertEquals(c.act, ["session.create"]);
  assertEquals(c.exp - c.iat, 30);
  assertEquals(c.org, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  // Sem cid/peer: credencial de sessão não descreve chamada nenhuma.
  assertEquals("cid" in c, false);
  assertEquals("peer" in c, false);
});

Deno.test("tc-admin global usa all=true booleano, não org='*'", async () => {
  await installKey();

  const t = await signAdminToken({ act: "session.list", all: true, sub: "u1" });
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(t.token.split(".")[1])));

  // String mágica em claim é bug esperando acontecer: uma org que se chamasse
  // "*" viraria autoridade global. Booleano não tem esse problema.
  assertEquals(c.all, true);
  assertEquals("org" in c, false);
});

Deno.test("tc-admin sem org e sem all é recusado", async () => {
  await installKey();
  await assertRejects(
    () => signAdminToken({ act: "session.list", sub: "u1" }),
    Error,
    "exige org ou all=true",
  );
});

// ─── tc-stream ──────────────────────────────────────────────────────────────

Deno.test("tc-stream vive 60s e carrega o veredito de visibilidade", async () => {
  await installKey();

  const t = await signStreamToken({
    org: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sub: "11111111-1111-1111-1111-111111111111",
    sid: "tc-sess",
    vis: "own",
  });
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(t.token.split(".")[1])));

  assertEquals(c.sc, "stream");
  assertEquals(c.act, ["events.read"]);
  assertEquals(c.exp - c.iat, 60);
  // A VPS recebe o VEREDITO, não a regra: ela não tem como avaliar
  // can_see_lead_by_permissions.
  assertEquals(c.vis, "own");
  assertEquals("pair_sid" in c, false);
});

Deno.test("pair_sid só aparece quando pedido — o QR é credencial", async () => {
  await installKey();

  const t = await signStreamToken({
    org: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sub: "u1",
    sid: "tc-sess",
    vis: "org",
    pairSid: "tc-sess",
  });
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(t.token.split(".")[1])));

  assertEquals(c.pair_sid, "tc-sess");
});
