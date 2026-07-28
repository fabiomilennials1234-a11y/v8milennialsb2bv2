#!/usr/bin/env node
/**
 * TSC ratchet: roda `tsc -p tsconfig.app.json --noEmit` e compara vs baseline
 * (.tsc-baseline.json). Falha SÓ em erros de tipo NOVOS (não presentes no
 * baseline) — nunca nos pré-existentes.
 *
 * Por que ratchet e não gate bloqueante: o codebase acumulou ~1.6k erros strict
 * porque o CI nunca rodou tsc (só eslint + vite build, que não checam tipos).
 * Um gate bloqueante reprovaria todo PR. O ratchet trava REGRESSÕES (ex.: o
 * `ReferenceError: useCustomPipelines is not defined` do LeadModal era um
 * TS2304 que teria sido pego aqui) sem exigir limpeza total de uma vez.
 *
 * Reduzir baseline (caminho saudável): corrija erros, rode
 *   npm run typecheck:baseline
 * e justifique cada delta no PR body. Nunca regenere às cegas.
 *
 * Espelha o padrão de scripts/dep-cruise-ratchet.cjs.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");

const BASELINE_FILE = ".tsc-baseline.json";
// Teto de HERDADOS: erros novos vs baseline que já estavam no repo antes da sua
// branch. Sem ele, quem toca qualquer arquivo leva exit 1 por dívida alheia e
// trava — foi o que travou o harness, porque o gate exigia zero absoluto num
// repo que não tem zero. Herdado avisa; só o que é SEU reprova.
// Espelha `scripts/metric-antipatterns-baseline.txt`: ratchet que só encolhe.
const PENDING_FILE = ".tsc-pending.json";
// Binário local explícito — `npx tsc` pode resolver um pacote-piada `tsc` no
// PATH quando typescript não está instalado ("This is not the tsc command...").
const TSC_CMD = "node ./node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit";

// Formato: path(line,col): error TSxxxx: message
const ERROR_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

function runTsc() {
  try {
    execSync(TSC_CMD, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    return ""; // exit 0 → zero erros
  } catch (err) {
    // tsc sai != 0 quando há erros; a saída vem em stdout.
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
}

function parse(output) {
  const errors = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = ERROR_RE.exec(raw.trim());
    if (!m) continue;
    const [, file, , , code, message] = m;
    errors.push({ file: file.replace(/\\/g, "/"), code, message: message.trim() });
  }
  return errors;
}

// Assinatura SEM line/col — estável a deslocamento de linhas (mexer em código
// não-relacionado não deve "inventar" erro novo). file+code+message identifica
// a falha de tipo. Mesmo critério de robustez do dep-cruise ratchet (rule+from+to).
function key(e) {
  return `${e.file}|${e.code}|${e.message}`;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`baseline ausente: ${BASELINE_FILE}. Rode: npm run typecheck:baseline`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

const writeMode = process.argv.includes("--write");
const writePendingMode = process.argv.includes("--write-pending");
const current = parse(runTsc());

if (writeMode) {
  const keys = [...new Set(current.map(key))].sort();
  const snapshot = { count: keys.length, generatedFrom: TSC_CMD, errors: keys };
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Baseline tsc gravado em ${BASELINE_FILE}: ${keys.length} assinaturas únicas (${current.length} ocorrências).`);
  process.exit(0);
}

const baseline = loadBaseline();
const baselineKeys = new Set(baseline.errors ?? []);
const seen = new Set();
const novel = [];
for (const e of current) {
  const k = key(e);
  if (baselineKeys.has(k) || seen.has(k)) continue;
  seen.add(k);
  novel.push(e);
}

if (writePendingMode) {
  const keys = [...new Set(novel.map(key))].sort();
  const snapshot = {
    count: keys.length,
    note: "Erros novos vs .tsc-baseline.json ainda nao corrigidos. TETO: so encolhe. Nao adicione entrada na mao — corrija o tipo.",
    errors: keys,
  };
  fs.writeFileSync(PENDING_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Teto de herdados gravado em ${PENDING_FILE}: ${keys.length} assinaturas.`);
  process.exit(0);
}

const pendingKeys = new Set(
  fs.existsSync(PENDING_FILE)
    ? JSON.parse(fs.readFileSync(PENDING_FILE, "utf8")).errors ?? []
    : [],
);

const blocking = novel.filter((e) => !pendingKeys.has(key(e)));
const inherited = novel.filter((e) => pendingKeys.has(key(e)));
const novelKeys = new Set(novel.map(key));
const resolved = [...pendingKeys].filter((k) => !novelKeys.has(k));

if (inherited.length > 0) {
  console.log(`\nℹ ${inherited.length} erro(s) HERDADO(S) — dívida do repo, não desta branch. NÃO bloqueiam.`);
  console.log(`  Lista completa em ${PENDING_FILE}. Não gaste tempo provando que não são seus.`);
}

if (resolved.length > 0) {
  console.log(`\n✔ ${resolved.length} herdado(s) resolvido(s) nesta branch. Encolha o teto:`);
  console.log("  npm run typecheck:pending");
}

if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} erro(s) de tipo INTRODUZIDO(S) por esta branch ` +
      `(tolerados: ${baselineKeys.size} de baseline + ${pendingKeys.size} herdados):\n`,
  );
  blocking.forEach((e) => console.error(`  [${e.code}] ${e.file}: ${e.message}`));
  console.error("\nEstes são seus. Corrija o tipo.");
  console.error("Se for refactor legítimo que move/renomeia erros já existentes, regenere:");
  console.error("  npm run typecheck:baseline");
  console.error("e justifique o delta no PR body. Nunca regenere às cegas.\n");
  process.exit(1);
}

console.log(
  `TSC ratchet OK — 0 erros introduzidos por esta branch. ` +
    `Tolerados: ${baselineKeys.size} de baseline + ${pendingKeys.size} herdados ` +
    `(${current.length} ocorrências atuais).`,
);
