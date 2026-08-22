#!/usr/bin/env node
/**
 * jira-new.mjs — cria issues a partir de um JSON, com pai opcional.
 *
 *   node scripts/jira-new.mjs --plan=<arquivo.json> [--apply]
 *
 * Plano: [{ "summary": "...", "description": "...", "type": "Tarefa",
 *           "parent": "SCRUM-359", "labels": ["ci"] }, ...]
 *
 * Sem `--apply` é dry-run. `type` aceita os nomes REAIS do projeto
 * (`Tarefa`, `História`, `Subtarefa`, `Epic`, `Bug`) — ver
 * `.specs/project/jira-type-map.json`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

function loadCreds() {
  const env = {
    JIRA_SITE: process.env.JIRA_SITE || '',
    JIRA_EMAIL: process.env.JIRA_EMAIL || '',
    JIRA_TOKEN: process.env.JIRA_TOKEN || '',
  };
  if (env.JIRA_SITE && env.JIRA_EMAIL && env.JIRA_TOKEN) return env;
  try {
    const raw = readFileSync(resolve('.jira.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?(JIRA_[A-Z_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      if (!env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* segue com o ambiente */ }
  return env;
}

const CREDS = loadCreds();
const SITE = (CREDS.JIRA_SITE || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${CREDS.JIRA_EMAIL}:${CREDS.JIRA_TOKEN}`).toString('base64');
const PROJECT = opt('project', 'SCRUM');
const APPLY = flag('apply');

if (!SITE || !CREDS.JIRA_EMAIL || !CREDS.JIRA_TOKEN) {
  console.error('faltam credenciais (JIRA_SITE/JIRA_EMAIL/JIRA_TOKEN ou .jira.env)');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`);
  return json;
}

/** Markdown pobre → ADF (parágrafo, bullet, bloco de código por indentação). */
function toAdf(texto) {
  const content = [];
  let bullets = null;
  const fecha = () => { if (bullets) { content.push(bullets); bullets = null; } };
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const t = linha.trim();
    if (!t) { fecha(); continue; }
    if (t.startsWith('- ')) {
      bullets ??= { type: 'bulletList', content: [] };
      bullets.content.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: t.slice(2) }] }],
      });
      continue;
    }
    fecha();
    content.push({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  }
  fecha();
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

const plano = JSON.parse(readFileSync(resolve(opt('plan')), 'utf8'));

const tipos = await api('GET', `/rest/api/3/project/${PROJECT}?expand=issueTypes`);
const porNome = new Map((tipos.issueTypes || []).map((t) => [t.name.toLowerCase(), t]));

let erros = 0;
for (const item of plano) {
  const tipo = porNome.get(String(item.type || 'Tarefa').toLowerCase());
  if (!tipo) {
    console.log(`  ✖ tipo "${item.type}" não existe em ${PROJECT} (tem: ${[...porNome.keys()].join(', ')})`);
    erros++;
    continue;
  }
  if (!APPLY) {
    console.log(`  ~ criar [${tipo.name}] ${item.summary.slice(0, 70)}${item.parent ? ` (pai ${item.parent})` : ''}`);
    continue;
  }
  try {
    const fields = {
      project: { key: PROJECT },
      issuetype: { id: tipo.id },
      summary: item.summary,
      description: toAdf(item.description),
      ...(item.labels ? { labels: item.labels } : {}),
      ...(item.parent ? { parent: { key: item.parent } } : {}),
    };
    const res = await api('POST', '/rest/api/3/issue', { fields });
    console.log(`  ✔ ${res.key} — ${item.summary.slice(0, 60)}`);
  } catch (e) {
    console.log(`  ✖ ${item.summary.slice(0, 40)} — ${e.message}`);
    erros++;
  }
}

console.log(APPLY ? `\naplicado · ${erros} erro(s)` : `\ndry-run — nada foi criado. Repita com --apply.`);
process.exitCode = erros ? 1 : 0;
