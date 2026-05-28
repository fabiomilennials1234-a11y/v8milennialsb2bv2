#!/usr/bin/env node
/**
 * Dep-cruise ratchet: roda depcruise atual e compara vs baseline.
 * Falha apenas em violations novas (não presentes em .dependency-cruiser-baseline.json).
 *
 * Para reduzir baseline: corrigir um import, depois rodar npm run lint:deps:baseline
 * para atualizar o snapshot. Commit com explicação no PR body.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");

const BASELINE_FILE = ".dependency-cruiser-baseline.json";

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`baseline file missing: ${BASELINE_FILE}. Run npm run lint:deps:baseline first.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

function runCurrent() {
  try {
    const out = execSync(
      "npx depcruise src --config .dependency-cruiser.cjs --output-type json",
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out);
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function violationKey(v) {
  return `${v.rule.name}|${v.from}|${v.to}`;
}

const baseline = loadBaseline();
const current = runCurrent();

const baselineKeys = new Set((baseline.summary?.violations ?? []).map(violationKey));
const currentViolations = current.summary?.violations ?? [];

const novel = currentViolations.filter((v) => !baselineKeys.has(violationKey(v)));

if (novel.length > 0) {
  console.error(`\n${novel.length} NEW dep-cruiser violation(s) vs baseline:\n`);
  novel.forEach((v) => {
    console.error(`  [${v.rule.name}] ${v.from} -> ${v.to}`);
  });
  console.error("\nFix the import OR (if intentional) regenerate baseline via:");
  console.error("  npm run lint:deps:baseline");
  console.error("\nNever regenerate baseline blindly — each removed entry should be justified in the PR body.\n");
  process.exit(1);
}

console.log(`Dep-cruise ratchet OK. Baseline pending: ${baselineKeys.size} violations.`);
