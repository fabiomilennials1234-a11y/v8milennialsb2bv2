#!/usr/bin/env node
// check-edge-test-config.mjs — guarda da config de TESTE do edge.
//
// Os testes de supabase/functions rodam com deno.test.json + deno.test.lock; o
// deploy segue com deno.json + deno.lock, intocados. A config de teste existe
// porque o esm.sh recompila a MESMA URL de versão exata (tslib@2.8.1 em
// 21/10/2026, zod@3.23.8 em 26/10/2026) enquanto o cache de cada POP do
// Cloudflare segue servindo os bytes velhos: o integrity check do lock reprovava
// o job "Edge Function Tests (Deno)" conforme o POP que o runner sorteava (12 de
// 145 execuções entre 28/10 e 11/11/2026). Registro npm é imutável por versão.
//
// Reprova se:
//   1. uma chave de "imports" do deno.json falta no deno.test.json (deriva);
//   2. fora do esm.sh, o alvo do teste difere do alvo do deploy;
//   3. um alvo esm.sh do deploy não vira npm: de versão exata no teste, ou a
//      própria URL não é remapeada para o mesmo pacote (~280 arquivos importam
//      https://esm.sh/@supabase/supabase-js@2 direto, sem passar pelo nome curto);
//   4. algum alvo do deno.test.json aponta para o esm.sh;
//   5. o deno.test.json não declara lock próprio e congelado;
//   6. uma task que roda o Deno sobre módulos não passa --config deno.test.json:
//      `deno task --config X` NÃO repassa X ao deno da task, que acharia sozinho
//      o deno.json de deploy e voltaria ao esm.sh sem ninguém perceber;
//   7. o lock de teste está ausente, vazio, não é JSON ou contém https://esm.sh/.
//
// Lock desatualizado (import novo) reprova no `npm run test:edge`, que roda
// congelado. Para atualizar: `npm run test:edge:lock` e commitar o deno.test.lock.
//
// Uso: node scripts/check-edge-test-config.mjs [diretório]   (padrão: supabase/functions)
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const dir = process.argv[2] ?? "supabase/functions";
const ESM = "https://esm.sh/";
const NPM_EXATO = /^npm:(@[^/@\s]+\/)?[^/@\s]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\/\S*)?$/;
const DENO_SOBRE_MODULOS = /\bdeno\s+(test|run|cache|check|bench)\b/;

const falhas = [];
const falha = (msg) => falhas.push(msg);
const ler = (arquivo) => {
  try {
    return JSON.parse(readFileSync(join(dir, arquivo), "utf8"));
  } catch (e) {
    console.error(`FALHA: ${join(dir, arquivo)} ilegível (${e.message})`);
    process.exit(1);
  }
};

const CONFIG = "deno.test.json";
const deploy = ler("deno.json").imports ?? {};
const config = ler(CONFIG);
const teste = config.imports ?? {};

// "Nada a verificar" e "não li nada" teriam a mesma saída verde.
if (Object.keys(deploy).length === 0) falha("o deno.json não tem imports: a guarda não verificou nada");

let trocados = 0;
for (const [chave, alvo] of Object.entries(deploy)) {
  if (!(chave in teste)) {
    falha(`"${chave}" está nos imports do deno.json e falta no ${CONFIG}`);
    continue;
  }
  if (!alvo.startsWith(ESM)) {
    if (teste[chave] !== alvo) {
      falha(`"${chave}": o deploy usa ${alvo} e o teste usa ${teste[chave]} (fora do esm.sh, têm que ser iguais)`);
    }
    continue;
  }
  trocados++;
  if (!NPM_EXATO.test(teste[chave])) {
    falha(`"${chave}": no deploy é ${alvo}; no teste tem que ser npm: com versão exata x.y.z, e é ${teste[chave]}`);
  }
  if (teste[alvo] !== teste[chave]) {
    falha(`a URL ${alvo} tem que ser chave do ${CONFIG} com o mesmo alvo de "${chave}" (${teste[chave]}); está ${teste[alvo] ?? "ausente"}`);
  }
}
for (const [chave, alvo] of Object.entries(teste)) {
  if (String(alvo).startsWith(ESM)) falha(`"${chave}" aponta para o esm.sh no ${CONFIG}: ${alvo}`);
}

let tasksComConfig = 0;
for (const [nome, task] of Object.entries(config.tasks ?? {})) {
  const comando = typeof task === "string" ? task : task?.command ?? "";
  for (const trecho of comando.split(/&&|\|\||[;|]/)) {
    if (!DENO_SOBRE_MODULOS.test(trecho)) continue;
    if (new RegExp(`(--config|-c)[= ]+${CONFIG.replaceAll(".", "\\.")}(\\s|$)`).test(trecho)) tasksComConfig++;
    else falha(`a task "${nome}" roda "${trecho.trim()}" sem --config ${CONFIG}: o deno da task usaria o deno.json de deploy`);
  }
}

const lock = config.lock;
let caminhoLock = null;
if (typeof lock?.path !== "string" || lock.frozen !== true) {
  falha(`o ${CONFIG} tem que declarar "lock": { "path": "./deno.test.lock", "frozen": true }`);
}
if (typeof lock?.path === "string") {
  caminhoLock = resolve(dir, lock.path);
  if (caminhoLock === resolve(dir, "deno.lock")) {
    falha(`o ${CONFIG} aponta para o deno.lock de DEPLOY; o teste usa um lock só dele`);
  }
}

let resumoLock = "";
if (caminhoLock) {
  const texto = existsSync(caminhoLock) ? readFileSync(caminhoLock, "utf8") : null;
  if (texto === null) falha(`lock de teste ausente: ${caminhoLock}`);
  else if (texto.trim() === "") falha(`lock de teste vazio: ${caminhoLock}`);
  else {
    try {
      const l = JSON.parse(texto);
      resumoLock = `${Object.keys(l.remote ?? {}).length} remote, ${Object.keys(l.npm ?? {}).length} npm`;
    } catch {
      falha(`lock de teste não é JSON: ${caminhoLock}`);
    }
    const doEsm = texto.split(ESM).length - 1;
    if (doEsm > 0) {
      falha(`o lock de teste tem ${doEsm} ocorrência(s) de ${ESM}: importe por npm: de versão exata (ver o ${CONFIG})`);
    }
  }
}

if (falhas.length > 0) {
  const prefixo = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "FALHA: ";
  for (const msg of falhas) console.error(prefixo + msg);
  process.exit(1);
}
console.log(
  `config de teste do edge ok: ${Object.keys(deploy).length} imports do deploy cobertos ` +
    `(${trocados} trocados de esm.sh por npm:), ${tasksComConfig} comando(s) deno com --config, ` +
    `lock ${basename(caminhoLock)} sem esm.sh (${resumoLock})`,
);
