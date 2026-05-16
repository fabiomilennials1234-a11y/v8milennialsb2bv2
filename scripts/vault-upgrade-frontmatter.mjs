#!/usr/bin/env node
/**
 * vault-upgrade-frontmatter — Adiciona/normaliza frontmatter em arquivos
 * legacy do vault. Idempotente.
 *
 * Lógica:
 *  - Detecta type via path (04 — Decisões/* = adr, 06 — Features/* = feature, ...)
 *  - Detecta title via primeiro H1 do arquivo
 *  - Preserva campos existentes (não sobrescreve)
 *  - Adiciona campos faltantes (type, title, status, created, updated, tags,
 *    related, owner)
 *
 * Uso: node scripts/vault-upgrade-frontmatter.mjs
 */

import fs from "node:fs";
import path from "node:path";

const VAULT_ROOT = "Obsidian/Segundo Cerebro/Claude Code — Torque CRM";

function inferType(relPath) {
  if (relPath.startsWith("01 — Identidade")) return "identity";
  if (relPath.startsWith("02 — Arquitetura")) return "architecture";
  if (relPath.startsWith("03 — Reference")) return "reference";
  if (relPath.startsWith("04 — Decisões") || /ADR-/.test(relPath)) return "adr";
  if (relPath.startsWith("05 — How-to")) return "howto";
  if (relPath.startsWith("06 — Features")) return "feature";
  if (relPath.startsWith("07 — Changelog")) return "changelog";
  if (relPath.startsWith("08 — Backlog")) return "backlog";
  if (relPath.startsWith("09 — Tutorials")) return "tutorial";
  if (relPath.startsWith("99 — Templates")) return "identity";
  return "identity";
}

function inferTitle(content, filename) {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return path.basename(filename, ".md");
}

function inferStatus(relPath, existing) {
  if (existing?.status) {
    // Normalize "aceita" → "accepted"
    if (existing.status === "aceita") return "accepted";
    return existing.status;
  }
  if (relPath.startsWith("04 — Decisões")) return "accepted";
  if (relPath.startsWith("07 — Changelog")) return "shipped";
  if (relPath.startsWith("08 — Backlog/em-progresso")) return "in-progress";
  if (relPath.startsWith("08 — Backlog/backlog")) return "backlog";
  if (relPath.startsWith("08 — Backlog/concluido")) return "archived";
  return "active";
}

function inferDate(filename, existing) {
  if (existing?.created) return existing.created;
  // Try YYYY-MM-DD in filename
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1];
  return "2026-04-12"; // vault inception date (fallback)
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return { fm: null, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { fm: null, body: content };
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
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
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
    } else {
      fm[key] = stripQuotes(val);
    }
  }
  return { fm, body };
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function serializeFrontmatter(fm) {
  const lines = ["---"];
  const order = [
    "type", "title", "status", "created", "updated",
    "tags", "related", "supersedes", "superseded_by",
    "owner", "priority", "estimated_hours", "branch", "pr",
    "area", "audience", "estimated_time_min", "expires",
  ];
  // First in canonical order
  for (const k of order) {
    if (fm[k] !== undefined) {
      lines.push(serializeField(k, fm[k]));
    }
  }
  // Then any other keys
  for (const k of Object.keys(fm)) {
    if (!order.includes(k)) {
      lines.push(serializeField(k, fm[k]));
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function serializeField(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    // Always quote items containing special chars to keep YAML valid
    const inline = `[${value
      .map((v) => (/[\s,:\[\]#@]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v))
      .join(", ")}]`;
    return `${key}: ${inline}`;
  }
  if (typeof value === "string" && /[:\[\]#@]/.test(value)) {
    return `${key}: "${value.replace(/"/g, '\\"')}"`;
  }
  return `${key}: ${value}`;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

// ===== main =====
let updated = 0;
let kept = 0;

for (const file of walk(VAULT_ROOT)) {
  const rel = path.relative(VAULT_ROOT, file).replace(/\\/g, "/");
  // Skip templates (have placeholder frontmatter)
  if (rel.startsWith("99 — Templates")) {
    kept++;
    continue;
  }

  const original = fs.readFileSync(file, "utf8");
  const { fm: existing, body } = parseFrontmatter(original);
  const fm = existing || {};

  const filename = path.basename(file);
  const inferred = {
    type: fm.type || inferType(rel),
    title: fm.title || inferTitle(body, filename),
    status: inferStatus(rel, fm),
    created: inferDate(filename, fm),
    updated: fm.updated && /^\d{4}-\d{2}-\d{2}$/.test(fm.updated)
      ? fm.updated
      : inferDate(filename, fm),
    tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
    related: Array.isArray(fm.related) ? fm.related : [],
    owner: fm.owner || "gabriel",
  };

  // Merge: existing wins, inferred fills gaps
  const merged = { ...inferred, ...fm };
  // Normalize edge cases
  if (merged.status === "aceita") merged.status = "accepted";
  // Re-apply inferred for required fields if existing was empty/missing
  if (!merged.type) merged.type = inferred.type;
  if (!merged.title) merged.title = inferred.title;
  if (!merged.status) merged.status = inferred.status;
  if (!merged.created) merged.created = inferred.created;
  if (!merged.tags || (Array.isArray(merged.tags) && merged.tags.length === 0)) {
    merged.tags = inferred.tags.length ? inferred.tags : ["uncategorized"];
  }

  const newFrontmatter = serializeFrontmatter(merged);
  const newContent = `${newFrontmatter}\n\n${body}`.replace(/\n\n+/g, "\n\n");

  if (newContent === original) {
    kept++;
    continue;
  }

  fs.writeFileSync(file, newContent);
  console.log(`✓ ${rel}`);
  updated++;
}

console.log(`\nvault-upgrade-frontmatter: ${updated} updated · ${kept} unchanged`);
