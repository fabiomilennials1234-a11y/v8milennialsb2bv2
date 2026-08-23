#!/usr/bin/env node
/**
 * jira-dump.mjs — lê o board e cospe um JSON com o estado real de cada issue.
 *
 * Só leitura. Serve pra cruzar o que o Jira diz com o que o código faz.
 *
 *   node scripts/jira-dump.mjs --project=SCRUM [--jql="..."] [--out=<path>]
 *
 * Credenciais: env vars ou `.jira.env` na raiz (gitignored), igual jira-import.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
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

const PROJECT = opt('project', 'SCRUM');
const JQL = opt('jql', `project = "${PROJECT}" ORDER BY created ASC`);
const OUT = resolve(opt('out', '.specs/project/jira-dump.json'));

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

/** ADF → texto plano, o suficiente pra ler critério de aceite. */
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  const kids = (node.content || []).map(adfText).join(
    node.type === 'paragraph' || node.type === 'listItem' || node.type === 'heading' ? '' : ''
  );
  const brk = ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type);
  return kids + (brk ? '\n' : '');
}

const fields = [
  'summary', 'status', 'assignee', 'reporter', 'issuetype', 'parent',
  'labels', 'created', 'updated', 'resolutiondate', 'description', 'priority',
  'subtasks', 'sprint', 'customfield_10020',
];

const out = [];
let nextPageToken = null;
for (;;) {
  const page = await api('POST', '/rest/api/3/search/jql', {
    jql: JQL, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}),
  });
  out.push(...(page.issues || []));
  nextPageToken = page.nextPageToken;
  if (!nextPageToken || page.isLast) break;
}

const rows = out.map((i) => ({
  key: i.key,
  type: i.fields.issuetype?.name,
  status: i.fields.status?.name,
  assignee: i.fields.assignee?.displayName || null,
  assigneeEmail: i.fields.assignee?.emailAddress || null,
  reporter: i.fields.reporter?.displayName || null,
  parent: i.fields.parent?.key || null,
  parentSummary: i.fields.parent?.fields?.summary || null,
  labels: i.fields.labels || [],
  created: i.fields.created,
  updated: i.fields.updated,
  resolved: i.fields.resolutiondate,
  sprint: (i.fields.customfield_10020 || []).map((s) => s.name || s),
  summary: i.fields.summary,
  description: adfText(i.fields.description).trim(),
}));

writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(`${rows.length} issues → ${OUT}`);

const byStatus = {};
const byAssignee = {};
for (const r of rows) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const a = r.assignee || '(sem responsável)';
  byAssignee[a] = (byAssignee[a] || 0) + 1;
}
console.log('status  ', byStatus);
console.log('assignee', byAssignee);
