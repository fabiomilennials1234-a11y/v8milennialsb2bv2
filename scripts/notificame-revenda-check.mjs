/**
 * Diagnóstico: a conta-mãe voltou a ser REVENDA no NotificaMe?
 *
 * Roda os três testes que separam "liberado" de "ainda bloqueado", do mais
 * inócuo ao mais invasivo. Os dois primeiros são LEITURA e não criam nada; o
 * terceiro CRIA uma subconta de verdade e por isso só roda com `--criar`.
 *
 * O token nunca entra neste arquivo nem no repositório: vem do ambiente.
 *
 *   NOTIFICAME_API_TOKEN=<token-da-conta-mae> node scripts/notificame-revenda-check.mjs
 *   NOTIFICAME_API_TOKEN=<token> node scripts/notificame-revenda-check.mjs --criar
 *
 * O que era medido em 2026-08-15, com a revenda desativada:
 *   GET  /v1/resale/            → funcionava (leitura sempre funcionou)
 *   GET  /v2/oauth/meta/start   → 401 "Invalid company", para QUALQUER uuid
 *   POST /v2/accounts           → 422 "company não é revenda"
 *
 * ⚠️ Este fornecedor MENTE no status HTTP: falha de autenticação vem como 404,
 * erro da Meta vem como 200 com o erro dentro do corpo. Por isso o veredito
 * abaixo olha o CORPO, e o status é impresso só como informação.
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * O token pode vir do ambiente ou de um `.env` local — nesta ordem. Ler do
 * arquivo evita colar segredo em terminal (e em conversa), que foi como o valor
 * vazou uma vez.
 */
function lerEnvDeArquivo(caminho) {
  if (!existsSync(caminho)) return {};
  const out = {};
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const arquivo = process.env.NOTIFICAME_ENV_FILE || ".env";
const doArquivo = lerEnvDeArquivo(arquivo);

const BASE = (
  process.env.NOTIFICAME_BASE_URL ||
  doArquivo.NOTIFICAME_API_BASE ||
  "https://api.notificame.com.br"
).replace(/\/+$/, "");
const TOKEN = (process.env.NOTIFICAME_API_TOKEN || doArquivo.NOTIFICAME_API_TOKEN || "").trim();
const CRIAR = process.argv.includes("--criar");

if (!TOKEN) {
  console.error("Falta NOTIFICAME_API_TOKEN — no ambiente ou no .env.");
  console.error("Uso: NOTIFICAME_API_TOKEN=<token> node scripts/notificame-revenda-check.mjs");
  console.error("  ou: NOTIFICAME_ENV_FILE=/caminho/.env node scripts/notificame-revenda-check.mjs");
  process.exit(1);
}

const headers = { "X-Api-Token": TOKEN, "Content-Type": "application/json" };

/** Corta o corpo para caber na tela sem esconder o veredito. */
function resumo(texto, limite = 400) {
  const t = (texto || "").trim().replace(/\s+/g, " ");
  return t.length > limite ? `${t.slice(0, limite)}…` : t || "(corpo vazio)";
}

function veredito(status, corpo) {
  const c = (corpo || "").toLowerCase();
  if (c.includes("não é revenda") || c.includes("nao e revenda") || c.includes("not a resale")) {
    return "BLOQUEADO — o fornecedor ainda diz que a conta não é revenda";
  }
  if (c.includes("invalid company")) {
    return "BLOQUEADO — 'Invalid company', o mesmo erro de antes";
  }
  if (c.includes("authentication_error")) {
    return "TOKEN INVÁLIDO — não é bloqueio de revenda, é credencial";
  }
  if (status >= 200 && status < 300) return "OK";
  return `INDEFINIDO — status ${status}, ler o corpo`;
}

async function chamar(rotulo, url, init = {}) {
  process.stdout.write(`\n── ${rotulo}\n   ${url.replace(TOKEN, "<token>")}\n`);
  try {
    const res = await fetch(url, { headers, ...init });
    const corpo = await res.text();
    console.log(`   HTTP ${res.status}`);
    console.log(`   corpo: ${resumo(corpo)}`);
    console.log(`   → ${veredito(res.status, corpo)}`);
    return { status: res.status, corpo };
  } catch (e) {
    console.log(`   FALHA DE REDE: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 0, corpo: "" };
  }
}

console.log("Diagnóstico de revenda — NotificaMe");
console.log(`base: ${BASE}`);

// 1. LEITURA — sempre funcionou, mesmo bloqueado. Serve de controle: se ISTO
//    falhar, o problema é o token ou a rede, e não a permissão de revenda.
const resale = await chamar("1. Listar subcontas (leitura, controle)", `${BASE}/v1/resale/`);

// 2. O ENDPOINT QUE ESTAVA BLOQUEADO. É GET e não cria nada — só devolve a URL
//    do popup de conexão. Era 401 "Invalid company" para qualquer uuid.
const uuidParaTeste = process.env.NOTIFICAME_TEST_COMPANY_UUID || TOKEN;
await chamar(
  "2. Iniciar conexão Seamless (era 401 'Invalid company')",
  `${BASE}/v2/oauth/meta/start` +
    `?company_uuid=${encodeURIComponent(uuidParaTeste)}` +
    `&redirect_origin=${encodeURIComponent("https://torquecrm.com.br")}` +
    `&type=whatsapp`,
);

// 3. ESCRITA — cria subconta de verdade. Só com --criar, e com nome datado para
//    ser reconhecível e removível depois.
if (CRIAR) {
  const marca = `diagnostico-${new Date().toISOString().slice(0, 10)}`;
  await chamar("3. Criar subconta (ESCRITA — cria de verdade)", `${BASE}/v2/accounts`, {
    method: "POST",
    body: JSON.stringify({
      name: `Torque ${marca}`,
      email: `torque+${marca}@torquecrm.com.br`,
    }),
  });
} else {
  console.log("\n── 3. Criar subconta — PULADO");
  console.log("   Este é o teste definitivo, e ele CRIA uma subconta real no fornecedor.");
  console.log("   Rode com --criar quando quiser fazê-lo.");
}

console.log("\n───────────────────────────────────────────");

/**
 * O CONTROLE DECIDE SE O RESTO SIGNIFICA ALGO.
 *
 * Medido em 2026-08-17: o token recusou no item 1, e o item 2 respondeu
 * "Invalid company" — que é exatamente o sintoma do bloqueio de revenda. Ler o
 * item 2 sozinho teria produzido o laudo errado ("continua bloqueado") quando o
 * fato era outro ("a credencial não é aceita"). Por isso o veredito final é
 * hierárquico: sem credencial, nada abaixo é conclusão.
 */
const credencialOk = !/AUTHENTICATION_ERROR|Invalid token/i.test(resale.corpo);

if (resale.status === 0) {
  console.log("Nem a leitura respondeu — problema de rede. Nada aqui é conclusão.");
} else if (!credencialOk) {
  console.log("VEREDITO: INCONCLUSIVO sobre revenda — a CREDENCIAL foi recusada.");
  console.log("O 'Invalid company' do item 2, se apareceu, NÃO prova bloqueio: com token");
  console.log("inválido tudo falha. Renove o token no painel do fornecedor e rode de novo.");
} else {
  console.log("Credencial aceita — agora sim o item 2 é leitura válida sobre a revenda.");
  console.log("O item 3 (com --criar) é a prova final.");
}
