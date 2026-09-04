#!/usr/bin/env node
/**
 * vault-regen-indexes — Regenera _MOC.md (Map of Content) em pastas do vault.
 *
 * Comportamento:
 *  - Para cada pasta numerada (00..99), gera _MOC.md listando filhos diretos
 *    agrupados por subpasta + ordenado alfabético.
 *  - Preserva seções marcadas `<!-- manual:start:<id> --> ... <!-- manual:end:<id> -->`.
 *  - Não toca 00 — INDEX.md (raiz mantida manual por enquanto).
 *  - Idempotente: rodar de novo sem mudança = no-op.
 *
 * Uso:
 *   node scripts/vault-regen-indexes.mjs                     # default
 *   node scripts/vault-regen-indexes.mjs --check             # exit 1 se mudaria algo (CI)
 *   node scripts/vault-regen-indexes.mjs --path <vault-root>
 *   node scripts/vault-regen-indexes.mjs --changed-from <git-ref>
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VAULT_ROOT_DEFAULT = "Obsidian/Segundo Cerebro/Claude Code — Torque CRM";

const args = process.argv.slice(2);
const vaultRoot =
  args.includes("--path")
    ? args[args.indexOf("--path") + 1]
    : VAULT_ROOT_DEFAULT;
const checkMode = args.includes("--check");
const changedFrom = args.includes("--changed-from")
  ? args[args.indexOf("--changed-from") + 1]
  : null;

if (args.includes("--changed-from") && !changedFrom) {
  console.error("vault-regen-indexes: --changed-from requires a git ref");
  process.exit(2);
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const raw = content.slice(4, end);
  const fm = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) {
      const val = m[2].trim();
      if (val !== "") fm[m[1]] = val.replace(/^["']|["']$/g, "");
    }
  }
  return fm;
}

function statusBadge(status) {
  switch (status) {
    case "draft":
      return "🟡 draft";
    case "active":
    case "accepted":
    case "shipped":
      return "";
    case "in-progress":
      return "🔵 wip";
    case "superseded":
    case "archived":
      return "📦 archived";
    default:
      return status ? `(${status})` : "";
  }
}

function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md") && d.name !== "_MOC.md")
    .map((d) => path.join(dir, d.name))
    .sort();
}

function listSubdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function generateMoc(folderPath, folderName, existingUpdated) {
  const directFiles = listMdFiles(folderPath);
  const subdirs = listSubdirs(folderPath);

  const lines = [];
  lines.push("---");
  lines.push(`type: ${inferType(folderName)}`);
  lines.push(`title: ${folderName} — Map of Content`);
  lines.push("status: active");
  lines.push(`created: 2026-05-15`);
  // Preserva `updated` existente para evitar drift em CI quando script roda
  // em dia diferente do último commit. Caller bumpa explicitamente se quiser.
  lines.push(`updated: ${existingUpdated || "2026-05-15"}`);
  lines.push("tags: [moc, auto-regenerated]");
  lines.push("related: []");
  lines.push("owner: claude-agent");
  lines.push("---");
  lines.push("");
  lines.push(`# ${folderName} — Map of Content`);
  lines.push("");
  lines.push("> Auto-gerado por `scripts/vault-regen-indexes.mjs`.");
  lines.push("> Seções marcadas `<!-- manual -->` são preservadas.");
  lines.push("");

  // Arquivos diretos
  if (directFiles.length > 0) {
    lines.push("## Notas nesta pasta");
    lines.push("");
    for (const file of directFiles) {
      const base = path.basename(file, ".md");
      const content = fs.readFileSync(file, "utf8");
      const fm = parseFrontmatter(content) || {};
      const title = fm.title || base;
      const badge = statusBadge(fm.status);
      lines.push(`- [[${base}|${title}]] ${badge}`.trim());
    }
    lines.push("");
  }

  // Subpastas
  for (const sub of subdirs) {
    const subFiles = listMdFiles(path.join(folderPath, sub));
    if (subFiles.length === 0) continue;
    lines.push(`## ${sub}`);
    lines.push("");
    for (const file of subFiles) {
      const base = path.basename(file, ".md");
      const content = fs.readFileSync(file, "utf8");
      const fm = parseFrontmatter(content) || {};
      const title = fm.title || base;
      const badge = statusBadge(fm.status);
      lines.push(`- [[${base}|${title}]] ${badge}`.trim());
    }
    lines.push("");
  }

  return lines.join("\n");
}

function inferType(folderName) {
  if (folderName.includes("Identidade")) return "identity";
  if (folderName.includes("Arquitetura")) return "architecture";
  if (folderName.includes("Reference")) return "reference";
  if (folderName.includes("Decisões")) return "adr";
  if (folderName.includes("How-to")) return "howto";
  if (folderName.includes("Features")) return "feature";
  if (folderName.includes("Changelog")) return "changelog";
  if (folderName.includes("Backlog")) return "backlog";
  if (folderName.includes("Tutorials")) return "tutorial";
  if (folderName.includes("Templates")) return "identity";
  return "identity";
}

function preserveManualSections(existing, generated) {
  if (!existing) return generated;
  // Encontra blocos manuais no existing
  const manualRe = /<!-- manual:start:([^\s>]+) -->([\s\S]*?)<!-- manual:end:\1 -->/g;
  const manualBlocks = new Map();
  let m;
  while ((m = manualRe.exec(existing)) !== null) {
    manualBlocks.set(m[1], m[0]);
  }
  // Substitui no generated se houver tags correspondentes
  let out = generated;
  for (const [id, block] of manualBlocks) {
    const placeholderRe = new RegExp(
      `<!-- manual:start:${id} -->[\\s\\S]*?<!-- manual:end:${id} -->`,
      "g",
    );
    if (placeholderRe.test(out)) {
      out = out.replace(placeholderRe, block);
    }
  }
  return out;
}

// ===== walk top-level folders =====
let topDirs = fs
  .readdirSync(vaultRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{2}\s/.test(d.name))
  .map((d) => d.name)
  .sort();

if (changedFrom) {
  let changedPaths;
  try {
    changedPaths = execFileSync(
      "git",
      ["diff", "--name-only", "-z", "--diff-filter=ACMRD", `${changedFrom}...HEAD`, "--", vaultRoot],
      { encoding: "utf8" },
    );
  } catch (error) {
    console.error(`vault-regen-indexes: unable to compare against ${changedFrom}`);
    if (error.stderr) console.error(error.stderr.trim());
    process.exit(2);
  }

  const changedTopDirs = new Set(
    changedPaths
      .split("\0")
      .filter(Boolean)
      .map((file) => path.relative(vaultRoot, file).split(path.sep)[0]),
  );
  topDirs = topDirs.filter((folder) => changedTopDirs.has(folder));
}

let changed = 0;
let kept = 0;

for (const folder of topDirs) {
  const folderPath = path.join(vaultRoot, folder);
  const mocPath = path.join(folderPath, "_MOC.md");
  const existing = fs.existsSync(mocPath)
    ? fs.readFileSync(mocPath, "utf8")
    : null;
  // Extrai updated existente para preservar (evita drift de data em CI)
  let existingUpdated = null;
  if (existing) {
    const m = existing.match(/^updated:\s*(\S+)/m);
    if (m) existingUpdated = m[1].replace(/["']/g, "");
  }
  const generated = generateMoc(folderPath, folder, existingUpdated);
  const final = preserveManualSections(existing, generated);

  if (existing === final) {
    kept++;
    continue;
  }

  if (checkMode) {
    console.error(`✗ Would update: ${mocPath}`);
    changed++;
    continue;
  }

  fs.writeFileSync(mocPath, final);
  console.log(`✓ Wrote: ${mocPath}`);
  changed++;
}

console.log(
  `\nvault-regen-indexes: ${changed} updated · ${kept} unchanged · ${topDirs.length} folders scanned`,
);

if (checkMode && changed > 0) {
  console.error(
    `\nMOCs out of date. Run: node scripts/vault-regen-indexes.mjs`,
  );
  process.exit(1);
}
process.exit(0);
