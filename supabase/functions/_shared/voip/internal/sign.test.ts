import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __resetKeyCacheForTests,
  publicKeyBase64,
  signVoipToken,
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
  sc: "call" as const,
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

  const { token } = await signVoipToken(ARGS);
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

  const { token } = await signVoipToken(ARGS);
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

  const first = await signVoipToken(ARGS);
  const header = JSON.parse(
    new TextDecoder().decode(b64urlToBytes(first.token.split(".")[0])),
  );
  assertEquals(header.alg, "EdDSA");
  assertEquals(header.typ, "JWT");
  assertEquals(header.kid, "tc1");

  Deno.env.set("TORQUECALLS_SIGNING_KID", "tc2");
  __resetKeyCacheForTests();

  const second = await signVoipToken(ARGS);
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
    () => signVoipToken(ARGS),
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

  await assertRejects(() => signVoipToken(ARGS), Error, "32 bytes");
  assertThrows(() => publicKeyBase64(), Error, "formato inesperado");
});

Deno.test("aud e env são obrigatórios — token de dev não pode discar em prod", async () => {
  await installKey();
  Deno.env.delete("TORQUECALLS_AUDIENCE");

  await assertRejects(() => signVoipToken(ARGS), Error, "TORQUECALLS_AUDIENCE ausente");

  Deno.env.set("TORQUECALLS_AUDIENCE", "calls.torquecrm.com.br");
  Deno.env.delete("TORQUECALLS_ENV");
  await assertRejects(() => signVoipToken(ARGS), Error, "TORQUECALLS_ENV ausente");
  Deno.env.set("TORQUECALLS_ENV", "test");
});
