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
//   3. um alvo esm.sh do deploy (https://esm.sh/<pacote>@<versão>[/caminho]) não
//      vira, no teste, npm: do MESMO pacote e caminho, com versão exata:
//        - igual à do deploy, quando ele fixa a versão (jose@5.9.6, zod@3.23.8);
//        - igual ao redirect do deno.lock de DEPLOY, quando ele usa range
//          (supabase-js@2 → 2.105.4); sem redirect, dentro do range (no @2, o
//          mesmo major), com aviso.
//      Vale para o nome curto e para a própria URL, que tem que ser chave do
//      deno.test.json com o mesmo alvo (~280 arquivos importam
//      https://esm.sh/@supabase/supabase-js@2 direto, sem passar pelo nome
//      curto). Chave-URL do esm.sh sem par no deploy segue a mesma regra, contra
//      o que o deploy resolve para aquela URL;
//   4. algum alvo do deno.test.json aponta para o esm.sh;
//   5. o deno.test.json não declara lock próprio e congelado;
//   6. uma task que roda o Deno sobre módulos não passa --config deno.test.json:
//      `deno task --config X` NÃO repassa X ao deno da task, que acharia sozinho
//      o deno.json de deploy e voltaria ao esm.sh sem ninguém perceber;
//   7. o lock de teste está ausente, vazio, não é JSON ou contém https://esm.sh/;
//   8. uma chave do deno.test.json não existe no deno.json e não é chave-URL do
//      esm.sh: o teste resolveria um specifier que o deploy não resolve;
//   9. o deno.json ou o deno.test.json declara scopes, importMap, links, patch ou
//      workspace: eles remapeiam a resolução por fora de "imports", que é o que
//      esta guarda confere. No Deno 2.9.8 (11/11/2026), um "scopes" no
//      deno.test.json levou o "zod" e a URL dele para o pacote jose, e o lock
//      congelado e o import-map.test.ts passaram.
//
// Lock desatualizado (import novo) reprova no `npm run test:edge`, que roda
// congelado. Para atualizar: `npm run test:edge:lock` e commitar o
// deno.test.lock. Ele EXECUTA a suíte sem congelar: import() montado em runtime,
// como o de oraculo-turno/http-fixture.ts, só entra no lock rodando o teste.
//
// Uso: node scripts/check-edge-test-config.mjs [diretório]   (padrão: supabase/functions)
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const dir = process.argv[2] ?? "supabase/functions";
const ESM = "https://esm.sh/";
// https://esm.sh/[v135/]<pacote>@<versão>[/caminho][?query]: o prefixo de build
// e a query mudam o que o esm.sh compila, não o pacote nem a versão.
const URL_ESM =
  /^https:\/\/esm\.sh\/(?:v\d+\/|stable\/)?((?:@[^/@?#\s]+\/)?[^/@?#\s]+)@([^/?#\s]+)(\/[^?#\s]*)?(?:\?[^#\s]*)?$/;
const NPM = /^npm:((?:@[^/@\s]+\/)?[^/@\s]+)@([^/\s]+)(\/\S*)?$/;
const EXATA = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Range na URL do esm.sh: 2, 2.39, 2.x, 2.39.x, ^2.39.3, ~2.39. O resto (latest,
// >=, ||) a guarda não lê, e reprova em vez de adivinhar.
const RANGE = /^([\^~])?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;
const DENO_SOBRE_MODULOS = /\bdeno\s+(test|run|cache|check|bench)\b/;
const REMAPEIAM = ["scopes", "importMap", "links", "patch", "workspace"];
const ATUALIZA_LOCK = "npm run test:edge:lock";

const falhas = [];
const falha = (msg) => falhas.push(msg);
const avisos = [];
const aviso = (msg) => avisos.push(msg);
const ler = (arquivo) => {
  let j;
  try {
    j = JSON.parse(readFileSync(join(dir, arquivo), "utf8"));
  } catch (e) {
    console.error(`FALHA: ${join(dir, arquivo)} ilegível (${e.message})`);
    process.exit(1);
  }
  if (j === null || typeof j !== "object" || Array.isArray(j)) {
    console.error(`FALHA: ${join(dir, arquivo)} não é um objeto JSON`);
    process.exit(1);
  }
  return j;
};

const CONFIG = "deno.test.json";
const configDeploy = ler("deno.json");
const deploy = configDeploy.imports ?? {};
const config = ler(CONFIG);
const teste = config.imports ?? {};

// "Nada a verificar" e "não li nada" teriam a mesma saída verde.
if (Object.keys(deploy).length === 0) falha("o deno.json não tem imports: a guarda não verificou nada");

for (const [arquivo, cfg] of [["deno.json", configDeploy], [CONFIG, config]]) {
  for (const chave of REMAPEIAM) {
    if (chave in cfg) {
      falha(
        `o ${arquivo} declara "${chave}", que remapeia a resolução por fora de "imports", ` +
          `e a guarda só confere "imports": tire-o ou estenda a guarda`,
      );
    }
  }
}

// O range do deploy (supabase-js@2) vira versão exata no redirect que o
// deno.lock de DEPLOY travou. É contra ele que o npm: do teste é conferido.
const lockDeploy = join(dir, "deno.lock");
const temLockDeploy = existsSync(lockDeploy);
let redirects = {};
if (temLockDeploy) {
  try {
    redirects = JSON.parse(readFileSync(lockDeploy, "utf8")).redirects ?? {};
  } catch (e) {
    falha(`o deno.lock de deploy não é JSON (${e.message}): sem ele a guarda não confere o range do deploy`);
  }
}

// [mínimo, teto) do range, em [major, minor, patch]; null se a guarda não lê.
function faixaDo(range) {
  const m = RANGE.exec(range);
  if (!m) return null;
  const [, op, a, b, c] = m;
  const curinga = (s) => s === undefined || /^[xX*]$/.test(s);
  if (curinga(b) && !curinga(c)) return null; // 2.x.3
  const [M, mi, p] = [Number(a), curinga(b) ? null : Number(b), curinga(c) ? null : Number(c)];
  let teto;
  if (op === "^" && M === 0 && mi !== null) teto = mi === 0 && p !== null ? [0, 0, p + 1] : [0, mi + 1, 0];
  else if (op === "^" || mi === null) teto = [M + 1, 0, 0];
  else if (op === "~" || p === null) teto = [M, mi + 1, 0];
  else return null; // x.y.z sem operador é versão exata, não range
  return { minimo: [M, mi ?? 0, p ?? 0], teto };
}
const compara = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// Pré-release não entra em range, como no semver.
function dentro(versao, faixa) {
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(versao)?.slice(1).map(Number);
  return v !== undefined && compara(v, faixa.minimo) >= 0 && compara(v, faixa.teto) < 0;
}

// O que o teste tem que usar no lugar de uma URL do esm.sh:
// { url, pacote, caminho, versao (null = range sem redirect), range, faixa, origem, viaRedirect } ou { erro }.
function esperadoPara(url) {
  const m = URL_ESM.exec(url);
  if (!m) {
    return {
      erro: `${url} não está no formato https://esm.sh/<pacote>@<versão>[/caminho], e a guarda não sabe a que pacote npm ele corresponde`,
    };
  }
  const [, pacote, versao, caminho = ""] = m;
  if (EXATA.test(versao)) return { url, pacote, caminho, versao, origem: url };
  const faixa = faixaDo(versao);
  let destino = url;
  for (let i = 0; i < 10 && typeof redirects[destino] === "string"; i++) destino = redirects[destino];
  if (destino !== url) {
    const r = URL_ESM.exec(destino);
    if (!r || r[1] !== pacote || !EXATA.test(r[2]) || (faixa && !dentro(r[2], faixa))) {
      return {
        erro: `o deno.lock de deploy redireciona ${url} para ${destino}, que não é ${pacote} numa versão exata dentro de "${versao}"`,
      };
    }
    return {
      url,
      pacote,
      caminho,
      versao: r[2],
      origem: `${url}, que o deno.lock de deploy trava em ${r[2]}`,
      viaRedirect: true,
    };
  }
  const semRedirect = temLockDeploy ? "sem redirect no deno.lock de deploy" : "sem deno.lock de deploy";
  if (!faixa) {
    return { erro: `${url} usa o range "${versao}", ${semRedirect}, e a guarda não sabe ler esse range` };
  }
  return { url, pacote, caminho, versao: null, range: versao, faixa, origem: `${url}, ${semRedirect}` };
}

const npmDe = (e) => `npm:${e.pacote}@${e.versao ?? `<versão exata dentro de "${e.range}">`}${e.caminho}`;
const semConferir = (e) =>
  `por estar dentro do range "${e.range}", sem conferir a versão exata que o deploy resolve ` +
  `(quem a diz é o redirect no deno.lock de deploy)`;

// Por que `alvoTeste` não serve no lugar do esperado `e`; null se serve.
function problema(alvoTeste, e) {
  const n = NPM.exec(String(alvoTeste));
  if (!n || !EXATA.test(n[2])) {
    return `no deploy é ${e.url}; no teste tem que ser npm: com versão exata x.y.z, e é ${alvoTeste}`;
  }
  const [, pacote, versao, caminho = ""] = n;
  if (pacote !== e.pacote) {
    return `o teste importa o pacote ${pacote} (${alvoTeste}) e o deploy, o pacote ${e.pacote} (${e.origem}): tem que ser o mesmo pacote`;
  }
  if (caminho !== e.caminho) {
    return `o teste importa ${pacote}${caminho || " (raiz)"} (${alvoTeste}) e o deploy, ${e.pacote}${e.caminho || " (raiz)"} (${e.origem}): tem que ser o mesmo caminho do pacote`;
  }
  if (e.versao !== null && versao !== e.versao) {
    return `o teste usa ${pacote} ${versao} (${alvoTeste}) e o deploy, ${e.versao} (${e.origem}): tem que ser a mesma versão`;
  }
  if (e.versao === null && !dentro(versao, e.faixa)) {
    return `o teste usa ${pacote} ${versao} (${alvoTeste}) e o deploy, o range "${e.range}" (${e.origem}): sem o redirect, a versão do teste tem que estar dentro do range`;
  }
  return null;
}

let trocados = 0;
let pelosRedirects = 0;
let soPeloRange = 0;
const urlsDoDeploy = new Set();
for (const [chave, alvo] of Object.entries(deploy)) {
  if (!(chave in teste)) {
    falha(`"${chave}" está nos imports do deno.json e falta no ${CONFIG}`);
    continue;
  }
  if (!String(alvo).startsWith(ESM)) {
    if (teste[chave] !== alvo) {
      falha(`"${chave}": o deploy usa ${alvo} e o teste usa ${teste[chave]} (fora do esm.sh, têm que ser iguais)`);
    }
    continue;
  }
  trocados++;
  urlsDoDeploy.add(alvo);
  const e = esperadoPara(alvo);
  if (e.erro) {
    falha(`"${chave}": ${e.erro}`);
    continue;
  }
  if (e.viaRedirect) pelosRedirects++;
  const como =
    `No ${CONFIG}, aponte o "${chave}" e a chave-URL "${alvo}" para ${npmDe(e)}, ` +
    `${e.versao === null ? "a versão exata que o deploy resolve" : "a versão do deploy"}, e rode ${ATUALIZA_LOCK}.`;
  const doNome = problema(teste[chave], e);
  if (doNome) falha(`"${chave}": ${doNome}. ${como}`);
  if (!(alvo in teste)) {
    falha(
      `a URL ${alvo}, alvo de "${chave}" no deno.json, falta como chave no ${CONFIG}: ` +
        `quem importa essa URL direto cairia no esm.sh. ${como}`,
    );
  } else if (teste[alvo] !== teste[chave]) {
    const daUrl = problema(teste[alvo], e);
    if (daUrl) falha(`a chave-URL "${alvo}": ${daUrl}. ${como}`);
    else if (!doNome) {
      falha(
        `a chave-URL "${alvo}" e o "${chave}" têm que apontar para o mesmo npm:, ` +
          `e apontam para ${teste[alvo]} e ${teste[chave]}. ${como}`,
      );
    }
  }
  if (e.versao === null && !doNome && teste[alvo] === teste[chave]) {
    soPeloRange++;
    aviso(`"${chave}": o deploy usa ${e.origem}; aceitei ${teste[chave]} ${semConferir(e)}`);
  }
}
for (const [chave, alvo] of Object.entries(teste)) {
  if (String(alvo).startsWith(ESM)) falha(`"${chave}" aponta para o esm.sh no ${CONFIG}: ${alvo}`);
  if (chave in deploy || urlsDoDeploy.has(chave)) continue;
  if (!chave.startsWith(ESM)) {
    falha(
      `"${chave}" está no ${CONFIG} e não existe no deno.json: o teste resolveria um specifier ` +
        `que o deploy não resolve. Tire-o do ${CONFIG} ou ponha-o antes no deno.json`,
    );
    continue;
  }
  // Chave-URL que não é alvo do deploy: algum arquivo importa a URL direto.
  const e = esperadoPara(chave);
  if (e.erro) {
    falha(`a chave-URL "${chave}", sem par no deno.json: ${e.erro}`);
    continue;
  }
  const p = problema(alvo, e);
  if (p) {
    falha(
      `a chave-URL "${chave}", sem par no deno.json: ${p}. Aponte-a para ${npmDe(e)}, o que o deploy ` +
        `resolve para essa URL, ou tire-a se nenhum arquivo importa essa URL direto, e rode ${ATUALIZA_LOCK}.`,
    );
  } else if (e.versao === null) {
    aviso(`a chave-URL "${chave}", sem par no deno.json: o deploy usa ${e.origem}; aceitei ${alvo} ${semConferir(e)}`);
  }
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

const noCI = process.env.GITHUB_ACTIONS === "true";
for (const msg of avisos) console.warn((noCI ? "::warning::" : "AVISO: ") + msg);
if (falhas.length > 0) {
  for (const msg of falhas) console.error((noCI ? "::error::" : "FALHA: ") + msg);
  process.exit(1);
}
const versoes =
  `versão igual em ${trocados - soPeloRange}` +
  (pelosRedirects > 0 ? `, ${pelosRedirects} pelo redirect do deno.lock de deploy` : "") +
  (soPeloRange > 0 ? `; só o range em ${soPeloRange} (ver o aviso)` : "");
console.log(
  `config de teste do edge ok: ${Object.keys(deploy).length} imports do deploy cobertos ` +
    `(${trocados} trocados de esm.sh por npm: do mesmo pacote; ${versoes}), ` +
    `${tasksComConfig} comando(s) deno com --config, ` +
    `lock ${basename(caminhoLock)} sem esm.sh (${resumoLock})`,
);
