#!/usr/bin/env node
/**
 * ESLint ratchet: roda `eslint .` e compara vs baseline (.eslint-baseline.json).
 * Reprova SÓ em problemas NOVOS — nunca nos pré-existentes.
 *
 * Por que ratchet e não `npm run lint` cru: o repo tem 0 errors e ~29k warnings.
 * `eslint .` sai 0 (verde), mas imprime 29.142 linhas terminadas em
 * "✖ 29142 problems". Isso quebrava o harness de duas formas medidas:
 *
 *   1. Subagente lia "29142 problems" como VERMELHO e reportava lint vermelho.
 *      O orchestrador então recusava o fan-out `revisor ‖ qa` — e esse bounce
 *      não é REPROVA nem FALHA, logo não entrava no cap de 2 voltas. Loop sem
 *      teto por dívida que a branch não criou.
 *   2. 29k linhas de warning herdado entravam no contexto do subagente, que
 *      gastava metade do output provando que não eram dele. Mesma patologia que
 *      travou o gate de tipos antes do `.tsc-pending.json` (commit 11164cdf).
 *
 * Este script dá as duas coisas que faltavam: veredito DELTA (introduzido vs
 * herdado) e output LIMITADO (teto de MAX_PRINT linhas).
 *
 * Reduzir baseline (caminho saudável): corrija warnings, rode
 *   npm run lint:baseline
 * e justifique cada delta no PR body. Nunca regenere às cegas.
 *
 * Espelha scripts/tsc-ratchet.cjs (baseline + teto de pendentes) e
 * scripts/dep-cruise-ratchet.cjs.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BASELINE_FILE = ".eslint-baseline.json";
// Teto de HERDADOS: problemas novos vs baseline que já estavam no repo antes da
// sua branch. Herdado avisa; só o que é SEU reprova. Só encolhe.
const PENDING_FILE = ".eslint-pending.json";

// --cache derruba a rerodada de ~7min pra segundos. 7min por execução é tempo
// que o subagente paga em toda volta do pipeline — o cache é parte do fix, não
// otimização opcional. Cache é local (gitignored); CI roda frio e correto.
const ESLINT_CMD = "node ./node_modules/eslint/bin/eslint.js . --format json --cache --cache-location .eslintcache";

// Teto de impressão: o ponto do ratchet é NÃO despejar 29k linhas no contexto
// de quem o roda. Erro introduzido em volume > 20 já é sinal suficiente.
const MAX_PRINT = 20;

const ROOT = process.cwd();

function runEslint() {
  try {
    return execSync(ESLINT_CMD, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  } catch (err) {
    // eslint sai != 0 quando há errors (severity 2); o JSON vem em stdout.
    if (err.stdout) return err.stdout;
    console.error("eslint falhou sem produzir JSON:");
    console.error(err.stderr || err.message);
    process.exit(2);
  }
}

function parse(raw) {
  let results;
  try {
    results = JSON.parse(raw);
  } catch {
    console.error("saída do eslint não é JSON válido. Rode `npm run lint` pra ver o erro cru.");
    process.exit(2);
  }
  const problems = [];
  for (const file of results) {
    const rel = path.relative(ROOT, file.filePath).replace(/\\/g, "/");
    for (const m of file.messages ?? []) {
      problems.push({
        file: rel,
        ruleId: m.ruleId ?? "(fatal)",
        message: (m.message ?? "").trim(),
        severity: m.severity,
      });
    }
  }
  return problems;
}

// Assinatura SEM line/col — estável a deslocamento de linhas: mexer em código
// não-relacionado não deve "inventar" problema novo. Mesmo critério do
// tsc-ratchet (file+code+message) e do dep-cruise (rule+from+to).
//
// Tradeoff aceito e herdado dos dois: adicionar uma 4ª ocorrência de um warning
// que já existe 3x NO MESMO ARQUIVO com a MESMA mensagem não é detectado. A
// alternativa (contagem por assinatura) reprova em movimentação pura de código,
// que é pior — falso positivo treina o time a regenerar baseline às cegas.
function key(p) {
  return `${p.file}|${p.ruleId}|${p.message}`;
}

function snapshot(keys, note) {
  return { count: keys.length, generatedFrom: ESLINT_CMD, note, errors: keys };
}

function printBounded(list, render, stream) {
  list.slice(0, MAX_PRINT).forEach((item) => stream(`  ${render(item)}`));
  if (list.length > MAX_PRINT) {
    stream(`  ... e mais ${list.length - MAX_PRINT}. Rode \`npm run lint\` pra lista completa.`);
  }
}

const writeMode = process.argv.includes("--write");
const writePendingMode = process.argv.includes("--write-pending");
const current = parse(runEslint());

if (writeMode) {
  const keys = [...new Set(current.map(key))].sort();
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(snapshot(keys, "Divida de lint congelada. So encolhe. Nao adicione entrada na mao — corrija o warning."), null, 2)}\n`,
  );
  console.log(
    `Baseline eslint gravado em ${BASELINE_FILE}: ${keys.length} assinaturas únicas (${current.length} ocorrências).`,
  );
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error(`baseline ausente: ${BASELINE_FILE}. Rode: npm run lint:baseline`);
  process.exit(2);
}
const baselineKeys = new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")).errors ?? []);

const seen = new Set();
const novel = [];
for (const p of current) {
  const k = key(p);
  if (baselineKeys.has(k) || seen.has(k)) continue;
  seen.add(k);
  novel.push(p);
}

if (writePendingMode) {
  const keys = [...new Set(novel.map(key))].sort();
  fs.writeFileSync(
    PENDING_FILE,
    `${JSON.stringify(snapshot(keys, "Problemas novos vs .eslint-baseline.json ainda nao corrigidos. TETO: so encolhe."), null, 2)}\n`,
  );
  console.log(`Teto de herdados gravado em ${PENDING_FILE}: ${keys.length} assinaturas.`);
  process.exit(0);
}

const pendingKeys = new Set(
  fs.existsSync(PENDING_FILE) ? JSON.parse(fs.readFileSync(PENDING_FILE, "utf8")).errors ?? [] : [],
);

const blocking = novel.filter((p) => !pendingKeys.has(key(p)));
const inherited = novel.filter((p) => pendingKeys.has(key(p)));
const novelKeys = new Set(novel.map(key));
const resolved = [...pendingKeys].filter((k) => !novelKeys.has(k));

if (inherited.length > 0) {
  console.log(`\nℹ ${inherited.length} problema(s) HERDADO(S) — dívida do repo, não desta branch. NÃO bloqueiam.`);
  console.log(`  Lista completa em ${PENDING_FILE}. Não gaste tempo provando que não são seus.`);
}

if (resolved.length > 0) {
  console.log(`\n✔ ${resolved.length} herdado(s) resolvido(s) nesta branch. Encolha o teto:`);
  console.log("  npm run lint:pending");
}

if (blocking.length > 0) {
  const errs = blocking.filter((p) => p.severity === 2);
  const warns = blocking.filter((p) => p.severity !== 2);
  console.error(
    `\n${blocking.length} problema(s) de lint INTRODUZIDO(S) por esta branch ` +
      `— ${errs.length} error(s), ${warns.length} warning(s). ` +
      `Tolerados: ${baselineKeys.size} de baseline + ${pendingKeys.size} herdados.\n`,
  );
  printBounded(blocking, (p) => `[${p.severity === 2 ? "error" : "warn"}] ${p.ruleId} — ${p.file}: ${p.message}`, (l) =>
    console.error(l),
  );
  console.error("\nEstes são seus. Corrija.");
  console.error("Se for refactor legítimo que move/renomeia problemas já existentes, regenere:");
  console.error("  npm run lint:baseline");
  console.error("e justifique o delta no PR body. Nunca regenere às cegas.\n");
  process.exit(1);
}

console.log(
  `ESLint ratchet OK — 0 problemas introduzidos por esta branch. ` +
    `Tolerados: ${baselineKeys.size} de baseline + ${pendingKeys.size} herdados ` +
    `(${current.length} ocorrências atuais).`,
);
