#!/usr/bin/env node
/**
 * jira-move.mjs — move issues de status e (opcionalmente) comenta o porquê.
 *
 * Escrita mínima e auditável: um card só muda de coluna com uma frase dizendo
 * qual evidência no código justificou a mudança. Sem `--apply` é dry-run.
 *
 *   node scripts/jira-move.mjs --to="Feito" --keys=SCRUM-316,SCRUM-360 \
 *     --comment="PR #1698 mergeado em develop" [--apply]
 *
 *   node scripts/jira-move.mjs --plan=<arquivo.json> [--apply]
 *   // plano: [{ "key": "SCRUM-316", "to": "Feito", "comment": "..." }, ...]
 *
 * Credenciais: env vars ou `.jira.env` na raiz (gitignored).
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
if (!SITE || !CREDS.JIRA_EMAIL || !CREDS.JIRA_TOKEN) {
  console.error('faltam credenciais (JIRA_SITE/JIRA_EMAIL/JIRA_TOKEN ou .jira.env)');
  process.exit(1);
}

const APPLY = flag('apply');

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
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  return json;
}

/** Markdown pobre → ADF. Só o que um comentário de auditoria usa. */
function toAdf(text) {
  const linhas = String(text || '').split(/\r?\n/);
  const content = [];
  let bullets = null;
  const fechaLista = () => { if (bullets) { content.push(bullets); bullets = null; } };
  for (const linha of linhas) {
    const t = linha.trim();
    if (!t) { fechaLista(); continue; }
    if (t.startsWith('- ')) {
      bullets ??= { type: 'bulletList', content: [] };
      bullets.content.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: t.slice(2) }] }],
      });
      continue;
    }
    fechaLista();
    content.push({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  }
  fechaLista();
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

const plano = opt('plan')
  ? JSON.parse(readFileSync(resolve(opt('plan')), 'utf8'))
  : (opt('keys') || '').split(',').map((s) => s.trim()).filter(Boolean).map((key) => ({
      key, to: opt('to'), comment: opt('comment') || null,
    }));

if (!plano.length) {
  console.error('nada a fazer — use --keys=... --to=... ou --plan=<arquivo.json>');
  process.exit(1);
}

let erros = 0;
for (const item of plano) {
  const { key, to, comment } = item;
  try {
    const issue = await api('GET', `/rest/api/3/issue/${key}?fields=status,summary`);
    const atual = issue.fields.status?.name;
    const resumo = issue.fields.summary;

    if (!to || atual.toLowerCase() === String(to).toLowerCase()) {
      console.log(`  =  ${key} já em "${atual}" — ${resumo.slice(0, 60)}`);
      if (!comment) continue;
    }

    const { transitions } = await api('GET', `/rest/api/3/issue/${key}/transitions`);
    const alvo = to && atual.toLowerCase() !== String(to).toLowerCase()
      ? transitions.find((tr) => (tr.to?.name || '').toLowerCase() === String(to).toLowerCase())
      : null;

    if (to && atual.toLowerCase() !== String(to).toLowerCase() && !alvo) {
      console.log(`  ✖ ${key} sem transição direta ${atual} → ${to} (tem: ${transitions.map((t) => t.to?.name).join(', ')})`);
      erros++;
      continue;
    }

    if (!APPLY) {
      console.log(`  ~ ${key} ${atual}${alvo ? ` → ${to}` : ' (sem mudança)'}${comment ? ' + comentário' : ''} — ${resumo.slice(0, 55)}`);
      continue;
    }

    if (comment) await api('POST', `/rest/api/3/issue/${key}/comment`, { body: toAdf(comment) });
    if (alvo) await api('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: alvo.id } });
    console.log(`  ✔ ${key} ${atual}${alvo ? ` → ${to}` : ''}${comment ? ' + comentário' : ''}`);
  } catch (e) {
    console.log(`  ✖ ${key} — ${e.message}`);
    erros++;
  }
}

console.log(APPLY ? `\naplicado · ${erros} erro(s)` : `\ndry-run — nada foi escrito. Repita com --apply.`);
process.exitCode = erros ? 1 : 0;
