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

const BASE = (process.env.NOTIFICAME_BASE_URL || "https://api.notificame.com.br").replace(/\/+$/, "");
const TOKEN = (process.env.NOTIFICAME_API_TOKEN || "").trim();
const CRIAR = process.argv.includes("--criar");

if (!TOKEN) {
  console.error("Falta NOTIFICAME_API_TOKEN no ambiente.");
  console.error("Uso: NOTIFICAME_API_TOKEN=<token> node scripts/notificame-revenda-check.mjs");
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
if (resale.status === 0) {
  console.log("Nem a leitura respondeu — verifique rede e token antes de concluir qualquer coisa.");
} else {
  console.log("Leia os três vereditos acima. O item 2 é o que separa liberado de bloqueado");
  console.log("sem criar nada; o item 3 é a prova final.");
}
