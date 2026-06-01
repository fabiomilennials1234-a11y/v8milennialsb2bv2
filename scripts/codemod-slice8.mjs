#!/usr/bin/env node
/**
 * Slice 8 codemod — atualiza imports após mover o BC `workflows`.
 *
 * Faz replace literal (case-sensitive) em arquivos .ts/.tsx sob src/ e tests/.
 * Não toca node_modules, dist, .specs, Obsidian.
 *
 * Padrão: replaces em ordem. Cada par [from, to] aplica replaceAll.
 *
 * NB: para hooks soltos (useWorkflows etc.) usamos paths exatos com aspas
 * para evitar match parcial.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "tests"];
const EXTS = new Set([".ts", ".tsx"]);

// Loose hooks movidos para src/modules/workflows/hooks/
// IMPORTANTE: ordem importa — strings mais longas/específicas primeiro.
const LOOSE_HOOKS = [
  // Workflow specifics longest-first
  "useWorkflowAnalytics",
  "useWorkflowPortability",
  "useWorkflowTemplates",
  "useWorkflows",
  // Stage / automation
  "useStageWorkflows",
  "useAutomationHealth",
  "useAutoFollowUp",
];

const REPLACEMENTS = [];

// Components folder — subpastas antes do prefixo genérico automacoes/
REPLACEMENTS.push(
  ['"@/components/automacoes/action-configs/', '"@/modules/workflows/components/action-configs/'],
  ['"@/components/automacoes/action-configs"', '"@/modules/workflows/components/action-configs"'],
  ['"@/components/automacoes/edges/', '"@/modules/workflows/components/edges/'],
  ['"@/components/automacoes/nodes/', '"@/modules/workflows/components/nodes/'],
  ['"@/components/automacoes/sidebar-panels/', '"@/modules/workflows/components/sidebar-panels/'],
  ['"@/components/automacoes/', '"@/modules/workflows/components/'],
  ['"@/components/automacoes"', '"@/modules/workflows/components"'],
);

// Loose hooks — only exact import paths (aspas fechando o nome do hook)
for (const h of LOOSE_HOOKS) {
  REPLACEMENTS.push(
    [`"@/hooks/${h}"`, `"@/modules/workflows/hooks/${h}"`],
  );
}

// Pages
REPLACEMENTS.push(
  ['"@/pages/AutomacoesEditor"', '"@/modules/workflows/pages/AutomacoesEditor"'],
  ['"@/pages/AutomacoesExecucoes"', '"@/modules/workflows/pages/AutomacoesExecucoes"'],
  ['"@/pages/Automacoes"', '"@/modules/workflows/pages/Automacoes"'],
);

// App.tsx usa import relativo
REPLACEMENTS.push(
  ['"./pages/AutomacoesEditor"', '"./modules/workflows/pages/AutomacoesEditor"'],
  ['"./pages/AutomacoesExecucoes"', '"./modules/workflows/pages/AutomacoesExecucoes"'],
  ['"./pages/Automacoes"', '"./modules/workflows/pages/Automacoes"'],
);

const stats = {
  filesScanned: 0,
  filesChanged: 0,
  replacementsByPattern: new Map(),
};

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(full);
      continue;
    }
    if (!st.isFile()) continue;
    if (!EXTS.has(extname(entry))) continue;
    processFile(full);
  }
}

function processFile(path) {
  stats.filesScanned++;
  let content;
  try { content = readFileSync(path, "utf8"); } catch { return; }
  let changed = false;
  for (const [from, to] of REPLACEMENTS) {
    if (content.includes(from)) {
      const before = content;
      let cnt = 0;
      let idx = 0;
      while ((idx = content.indexOf(from, idx)) !== -1) { cnt++; idx += from.length; }
      content = content.split(from).join(to);
      if (content !== before) {
        changed = true;
        stats.replacementsByPattern.set(
          from,
          (stats.replacementsByPattern.get(from) ?? 0) + cnt
        );
      }
    }
  }
  if (changed) {
    writeFileSync(path, content, "utf8");
    stats.filesChanged++;
  }
}

for (const d of SCAN_DIRS) {
  walk(join(ROOT, d));
}

console.log(`Scanned: ${stats.filesScanned}`);
console.log(`Changed: ${stats.filesChanged}`);
console.log("Replacements:");
for (const [pat, count] of [...stats.replacementsByPattern.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}  ${pat}`);
}
