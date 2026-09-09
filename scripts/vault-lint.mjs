#!/usr/bin/env node
/**
 * vault-lint — Valida integridade do vault Obsidian.
 *
 * Checks:
 *  1. Frontmatter presente + campos obrigatórios (type, title, status, created)
 *  2. type ∈ enum válido
 *  3. status ∈ enum válido
 *  4. created/updated formato YYYY-MM-DD
 *  5. tags é array
 *  6. Wikilinks [[...]] resolvem para arquivo existente (por filename global)
 *
 * Exit 0 = OK. Exit 1 = violations.
 *
 * Uso:
 *   node scripts/vault-lint.mjs                          # default vault path
 *   node scripts/vault-lint.mjs --path <vault-root>
 *   node scripts/vault-lint.mjs --changed-from <git-ref> # only changed docs
 *   node scripts/vault-lint.mjs --fail-on-warn           # warns fail too
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VAULT_ROOT_DEFAULT = "Obsidian/Segundo Cerebro/Claude Code — Torque CRM";

const VALID_TYPES = new Set([
  "adr",
  "feature",
  "howto",
  "tutorial",
  "reference",
  "changelog",
  "backlog",
  "identity",
  "architecture",
]);

const VALID_STATUSES = new Set([
  "draft",
  "active",
  "accepted",
  "superseded",
  "archived",
  "shipped",
  "in-progress",
  "backlog",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// ===== args =====
const args = process.argv.slice(2);
const vaultRoot =
  args.includes("--path")
    ? args[args.indexOf("--path") + 1]
    : VAULT_ROOT_DEFAULT;
const failOnWarn = args.includes("--fail-on-warn");
const changedFrom = args.includes("--changed-from")
  ? args[args.indexOf("--changed-from") + 1]
  : null;

if (args.includes("--changed-from") && !changedFrom) {
  console.error("vault-lint: --changed-from requires a git ref");
  process.exit(2);
}

// ===== walk =====
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

// ===== frontmatter parser (minimal YAML) =====
function parseFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const raw = content.slice(4, end);
  const fm = {};
  let currentKey = null;
  let arrayMode = false;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const arrayMatch = line.match(/^\s+-\s+(.*)$/);
    if (arrayMode && arrayMatch) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(stripQuotes(arrayMatch[1]));
      continue;
    }
    arrayMode = false;
    const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const [, key, rawVal] = kvMatch;
    currentKey = key;
    const val = rawVal.trim();
    if (val === "") {
      arrayMode = true;
      fm[key] = [];
    } else if (val.startsWith("[") && val.endsWith("]")) {
      // inline array: [a, b, c]
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
    } else {
      fm[key] = stripQuotes(val);
    }
  }
  return fm;
}

function stripQuotes(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// ===== main =====
if (!fs.existsSync(vaultRoot)) {
  console.error(`vault-lint: directory not found: ${vaultRoot}`);
  process.exit(2);
}

const allFiles = walk(vaultRoot);
let files = allFiles;

if (changedFrom) {
  let changedPaths;
  try {
    changedPaths = execFileSync(
      "git",
      ["diff", "--name-only", "-z", "--diff-filter=ACMR", `${changedFrom}...HEAD`, "--", vaultRoot],
      { encoding: "utf8" },
    );
  } catch (error) {
    console.error(`vault-lint: unable to compare against ${changedFrom}`);
    if (error.stderr) console.error(error.stderr.trim());
    process.exit(2);
  }

  const changedSet = new Set(
    changedPaths
      .split("\0")
      .filter(Boolean)
      .map((file) => path.resolve(file)),
  );
  files = allFiles.filter((file) => changedSet.has(path.resolve(file)));
}
const errors = [];
const warnings = [];

// Build set of all filenames (without extension) for wikilink resolution
const filenamesByBase = new Map();
for (const f of allFiles) {
  const base = path.basename(f, ".md");
  if (!filenamesByBase.has(base)) filenamesByBase.set(base, []);
  filenamesByBase.get(base).push(f);
}

for (const file of files) {
  const rel = path.relative(vaultRoot, file);
  // Templates folder contém placeholders <...> — skip strict checks
  const isTemplate = rel.startsWith("99 — Templates") || rel.includes("99 — Templates");
  const content = fs.readFileSync(file, "utf8");
  const fm = parseFrontmatter(content);

  // 1. Frontmatter presente
  if (!fm) {
    if (isTemplate) warnings.push(`${rel}: missing frontmatter (template)`);
    else errors.push(`${rel}: missing frontmatter`);
    continue;
  }

  // 2. Required fields
  for (const field of ["type", "title", "status", "created"]) {
    if (!fm[field]) {
      const msg = `${rel}: missing frontmatter field "${field}"`;
      if (isTemplate) warnings.push(msg);
      else errors.push(msg);
    }
  }

  // 3. Type enum
  if (fm.type && !VALID_TYPES.has(fm.type)) {
    errors.push(
      `${rel}: invalid type "${fm.type}" (valid: ${[...VALID_TYPES].join(", ")})`,
    );
  }

  // 4. Status enum
  if (fm.status && !VALID_STATUSES.has(fm.status)) {
    errors.push(
      `${rel}: invalid status "${fm.status}" (valid: ${[...VALID_STATUSES].join(", ")})`,
    );
  }

  // 5. Date format
  if (fm.created && !DATE_RE.test(fm.created)) {
    const msg = `${rel}: created "${fm.created}" not YYYY-MM-DD`;
    if (isTemplate) warnings.push(msg);
    else errors.push(msg);
  }
  if (fm.updated && !DATE_RE.test(fm.updated)) {
    warnings.push(`${rel}: updated "${fm.updated}" not YYYY-MM-DD`);
  }

  // 6. Tags array
  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    errors.push(`${rel}: tags must be array`);
  }

  // 7. Wikilinks (skip templates — contain placeholders <...>)
  if (!isTemplate) {
    const matches = [...content.matchAll(WIKILINK_RE)];
    for (const m of matches) {
      const target = m[1].trim();
      // Skip URL-like, section-only, or placeholder links
      if (target.startsWith("http") || target.startsWith("#")) continue;
      if (target.startsWith("<") && target.endsWith(">")) continue;  // placeholder
      if (target === "ref1" || target === "ref2") continue;  // common placeholder names
      // Extract just the filename part (could be "path/file" or "file")
      const targetBase = path.basename(target);
      if (!filenamesByBase.has(targetBase)) {
        warnings.push(`${rel}: wikilink "[[${target}]]" does not resolve`);
      }
    }
  }
}

// ===== report =====
const hasErrors = errors.length > 0;
const hasWarnings = warnings.length > 0;

if (hasErrors) {
  console.error("\n=== vault-lint ERRORS ===");
  for (const e of errors) console.error("✗ " + e);
}
if (hasWarnings) {
  console.warn("\n=== vault-lint WARNINGS ===");
  for (const w of warnings) console.warn("⚠ " + w);
}

console.log(
  `\nvault-lint: ${files.length} file(s) scanned · ${errors.length} error(s) · ${warnings.length} warning(s)`,
);

if (hasErrors || (failOnWarn && hasWarnings)) {
  process.exit(1);
}
process.exit(0);
