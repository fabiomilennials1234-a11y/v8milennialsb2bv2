#!/usr/bin/env node
/**
 * Slice 7 codemod — atualiza imports após mover o BC `copilot`.
 *
 * Faz replace literal (case-sensitive) em arquivos .ts/.tsx sob src/ e tests/.
 * Não toca node_modules, dist, .specs, Obsidian.
 *
 * Padrão: replaces em ordem. Cada par [from, to] aplica replaceAll.
 *
 * NB: para hooks soltos (useCopilotToggle etc.) usamos paths exatos com aspas
 * para evitar match parcial (ex: "useCopilotToggle" não pode afetar
 * "useCopilotToggleAudit" ou "useCopilotToggleRealtime").
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "tests"];
const EXTS = new Set([".ts", ".tsx"]);

// ────────────────────────────────────────────────────────────────────────
// Mapping table
// Order: mais específicos primeiro (toggle audit/realtime ANTES de toggle puro)
// ────────────────────────────────────────────────────────────────────────

// Loose hooks movidos para src/modules/copilot/hooks/
// IMPORTANTE: ordem importa — strings mais longas/específicas primeiro.
const LOOSE_HOOKS = [
  "useAgentDocuments",
  "useAgentFollowupRules",
  "useAgentKanbanRules",
  "useAgentMetrics",
  "useCopilotAgentAudios",
  "useCopilotAgents",
  "useCopilotPause",
  "useCopilotPromptBuilder",
  "useCopilotReasoning",
  "useCopilotSubscription",
  // Toggle trio — específicos antes do genérico
  "useCopilotToggleAudit",
  "useCopilotToggleRealtime",
  "useCopilotToggle",
  "useOraculoChat",
  "usePromptAnalysis",
  "useQuickPromptAnalysis",
  "useToolCallLogs",
];

const REPLACEMENTS = [];

// Components folder — playground antes do prefixo genérico copilot/
REPLACEMENTS.push(
  ['"@/components/copilot/playground/', '"@/modules/copilot/components/playground/'],
  ['"@/components/copilot/playground"', '"@/modules/copilot/components/playground"'],
  ['"@/components/copilot/', '"@/modules/copilot/components/'],
  ['"@/components/copilot"', '"@/modules/copilot/components"'],
);

// Loose hooks — only exact import paths (aspas fechando o nome do hook)
for (const h of LOOSE_HOOKS) {
  REPLACEMENTS.push(
    [`"@/hooks/${h}"`, `"@/modules/copilot/hooks/${h}"`],
  );
}

// Pages
REPLACEMENTS.push(
  ['"@/pages/CopilotMetrics"', '"@/modules/copilot/pages/CopilotMetrics"'],
  ['"@/pages/Copilot"', '"@/modules/copilot/pages/Copilot"'],
);

// ────────────────────────────────────────────────────────────────────────
// Walk + replace
// ────────────────────────────────────────────────────────────────────────

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
