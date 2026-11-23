#!/usr/bin/env node
// Chave de assinatura do crm-mcp (ADR 0012, emenda 2026-11-23). Management API, sem CLI.
//
//   node scripts/crm-mcp-chave.mjs status     <ref>
//   node scripts/crm-mcp-chave.mjs provisionar <ref> [--liberar-standby] [--confirmo-producao]
//   node scripts/crm-mcp-chave.mjs revogar    <ref> <kid> [--confirmo-producao]
//
// provisionar:
//   1. o projeto só tem UM slot `standby`. Se ele estiver ocupado (em prod: o HS256 legado),
//      aborta — a menos que --liberar-standby, que move o ocupante para `previously_used`
//      (continua verificando: nada que ele assina deixa de valer);
//   2. gera uma ES256 EM MEMÓRIA, importa como `standby` e move para `previously_used`
//      (só verificação; uma rotação no painel nunca a promove a chave de sessão);
//   3. grava CRM_MCP_JWT_SIGNING_KEY e CRM_MCP_JWT_KID nos secrets do projeto;
//   4. prova que o PostgREST confia nela (JWT de teste → 200, não 401).
// A chave privada nunca é escrita em disco nem impressa.
//
// ⚠️ Quem tem essa chave forja QUALQUER papel do projeto, inclusive service_role. Ela vive
// só nos secrets do projeto. Vazou → `revogar` (efeito imediato) e `provisionar` de novo.
//
// Token: SUPABASE_ACCESS_TOKEN (sbp_) do ambiente, ou a linha sbp_ do .env.development.
import { createPrivateKey, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const PROD = "jsjsmuncfkbsbzqzqhfq";
const [acao, ref, kidArg] = process.argv.slice(2);
const flag = (f) => process.argv.includes(f);

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.startsWith("sbp_")) return process.env.SUPABASE_ACCESS_TOKEN;
  const t = readFileSync(".env.development", "utf8").split(/\r?\n/)
    .filter((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="))
    .map((l) => l.slice(l.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, ""))
    .find((v) => v.startsWith("sbp_"));
  if (!t) throw new Error("SUPABASE_ACCESS_TOKEN (sbp_) ausente");
  return t;
}
const TOKEN = token();

async function api(method, path, body) {
  const r = await fetch(`https://api.supabase.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "supabase-cli/2.117" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 500)}`);
  return json;
}
const chaves = async () => (await api("GET", `projects/${ref}/config/auth/signing-keys`)).keys;
const resumo = (ks) => ks.map((k) => `${k.id} ${k.algorithm} ${k.status}`).join("\n  ");

if (!/^[a-z]{20}$/.test(ref ?? "")) throw new Error("ref inválido");
if (ref === PROD && acao !== "status" && !flag("--confirmo-producao")) {
  throw new Error("produção: repita com --confirmo-producao (mudança de auth do projeto inteiro)");
}

if (acao === "status") {
  console.log(`chaves de ${ref}:\n  ${resumo(await chaves())}`);
  const secrets = await api("GET", `projects/${ref}/secrets`);
  const nomes = secrets.map((s) => s.name).filter((n) => n.startsWith("CRM_MCP_"));
  console.log(`secrets crm-mcp: ${nomes.join(", ") || "(nenhum)"}`);
} else if (acao === "provisionar") {
  let ks = await chaves();
  const ocupante = ks.find((k) => k.status === "standby");
  if (ocupante) {
    if (!flag("--liberar-standby")) {
      throw new Error(
        `o slot standby está ocupado por ${ocupante.id} (${ocupante.algorithm}). ` +
          "Repita com --liberar-standby para movê-lo a previously_used (continua verificando).",
      );
    }
    await api("PATCH", `projects/${ref}/config/auth/signing-keys/${ocupante.id}`, { status: "previously_used" });
    console.log(`standby ${ocupante.id} (${ocupante.algorithm}) → previously_used`);
  }

  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  const kid = randomUUID();
  const privada = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid, alg: "ES256", use: "sig", key_ops: ["sign", "verify"], ext: true };
  await api("POST", `projects/${ref}/config/auth/signing-keys`, { algorithm: "ES256", status: "standby", private_jwk: privada });
  await api("PATCH", `projects/${ref}/config/auth/signing-keys/${kid}`, { status: "previously_used" });
  console.log(`chave crm-mcp ${kid} importada (previously_used)`);

  await api("POST", `projects/${ref}/secrets`, [
    { name: "CRM_MCP_JWT_SIGNING_KEY", value: JSON.stringify(privada) },
    { name: "CRM_MCP_JWT_KID", value: kid },
  ]);
  console.log("secrets CRM_MCP_JWT_SIGNING_KEY / CRM_MCP_JWT_KID gravados");

  // Prova de confiança: JWT de usuário inexistente → is_master_user responde 200 (false).
  const anon = (await api("GET", `projects/${ref}/api-keys?reveal=true`)).find((k) => k.id === "anon" || k.name === "anon").api_key;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  let ok = false;
  for (let i = 0; i < 12 && !ok; i++) {
    const agora = Math.floor(Date.now() / 1000);
    const entrada = `${b64({ alg: "ES256", typ: "JWT", kid })}.${b64({ role: "authenticated", aud: "authenticated", sub: randomUUID(), iat: agora, exp: agora + 30 })}`;
    const assinatura = createSign("SHA256").update(entrada).sign({ key: createPrivateKey({ key: privada, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
    const r = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/is_master_user`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${entrada}.${assinatura}`, "Content-Type": "application/json" },
      body: "{}",
    });
    ok = r.status === 200;
    if (!ok) await new Promise((res) => setTimeout(res, 5000));
  }
  console.log(ok ? "PostgREST confia na chave ✓" : "PostgREST AINDA NÃO aceita a chave — confira em 1 min com `status`");
  console.log(`chaves agora:\n  ${resumo(await chaves())}`);
  if (!ok) process.exit(2);
} else if (acao === "revogar") {
  if (!kidArg) throw new Error("informe o kid");
  const k = (await chaves()).find((x) => x.id === kidArg);
  if (!k) throw new Error("kid não encontrado");
  if (k.status === "standby") await api("PATCH", `projects/${ref}/config/auth/signing-keys/${kidArg}`, { status: "previously_used" });
  await api("PATCH", `projects/${ref}/config/auth/signing-keys/${kidArg}`, { status: "revoked" });
  console.log(`${kidArg} revogada — todo JWT assinado por ela para de valer.`);
} else {
  console.log("uso: status <ref> | provisionar <ref> [--liberar-standby] [--confirmo-producao] | revogar <ref> <kid> [--confirmo-producao]");
}
