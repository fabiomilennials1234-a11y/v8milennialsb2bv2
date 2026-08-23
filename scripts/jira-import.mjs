#!/usr/bin/env node
/**
 * jira-import.mjs — sobe o inventário Leads↔Negócios para o Jira Cloud.
 *
 * Idempotente pela chave de inventário (label `inv:*`): antes de criar qualquer
 * issue, procura por ela via JQL. Achou → reconcilia (parent/summary/labels e
 * transição de status). Não achou → cria. Rodar duas vezes não duplica nada.
 *
 * Uso:
 *   JIRA_SITE=https://<site>.atlassian.net \
 *   JIRA_EMAIL=<conta> \
 *   JIRA_TOKEN=<api-token> \
 *   node scripts/jira-import.mjs --preflight        # só lê metadados e compara com o CSV
 *   node scripts/jira-import.mjs --dry-run          # plano completo, zero escrita (default)
 *   node scripts/jira-import.mjs --apply --pilot    # Epic + Story H1 + as sub-tasks dela
 *   node scripts/jira-import.mjs --apply            # tudo
 *   node scripts/jira-import.mjs --report           # só conta por status via JQL
 *
 * Flags:
 *   --csv=<path>          default .specs/project/jira-leads-negocios.csv
 *   --project=<KEY>       default TOR (ou a coluna Project Key do CSV)
 *   --pilot               restringe a EPIC + H1 + sub-tasks de H1
 *   --only=<k1,k2,...>    restringe a chaves inv: (prefixo casa: --only=H3 pega H3 e H3-*)
 *   --status-map=<path>   JSON { "Status do CSV": "Status real do Jira" }
 *   --type-map=<path>     JSON { "Epic": "Epico", "Story": "História", "Sub-task": "Subtarefa" }
 *   --no-transitions      cria/reconcilia mas não move de status
 *   --sprint-id=<n>       força a sprint (default: a única ativa do board do projeto)
 *   --no-sprint           não mexe em sprint
 *   --no-labels           não manda labels (fallback se o Jira recusar ":" em label)
 *   --concurrency=<n>     default 4
 *
 * O token entra por env var. Nunca é logado, nunca vai para arquivo.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────── args & env

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const MODE = flag('report')
  ? 'report'
  : flag('preflight')
    ? 'preflight'
    : flag('apply')
      ? 'apply'
      : 'dry-run';

const CSV_PATH = resolve(opt('csv', '.specs/project/jira-leads-negocios.csv'));
const PILOT = flag('pilot');
const ONLY = (opt('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const DO_TRANSITIONS = !flag('no-transitions');
const WANT_SPRINT = !flag('no-sprint');
const SPRINT_ID = opt('sprint-id');
const SEND_LABELS = !flag('no-labels');
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '4')) || 4);

/**
 * Credenciais: env vars primeiro; se faltarem, cai em `.jira.env` na raiz
 * (gitignored). O arquivo existe pra o token não precisar ser colado num
 * terminal compartilhado nem num transcript de agente. Nunca commitar.
 */
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
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!env[m[1]]) env[m[1]] = val;
    }
  } catch { /* sem arquivo, segue com o que houver no ambiente */ }
  return env;
}

const CREDS = loadCreds();
const SITE = (CREDS.JIRA_SITE || '').replace(/\/+$/, '');
const EMAIL = CREDS.JIRA_EMAIL || '';
const TOKEN = CREDS.JIRA_TOKEN || '';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', bold: '\x1b[1m',
};
const say = (...a) => console.log(...a);
const warn = (...a) => console.log(C.yellow + '⚠ ' + C.reset, ...a);
const bad = (...a) => console.log(C.red + '✖ ' + C.reset, ...a);
const ok = (...a) => console.log(C.green + '✔ ' + C.reset, ...a);

function die(msg) {
  bad(msg);
  process.exit(1);
}

const placeholder = Object.entries({ JIRA_SITE: SITE, JIRA_EMAIL: EMAIL, JIRA_TOKEN: TOKEN })
  .filter(([, v]) => /^<.*>$/.test(v) || /^(cole|preencha|seusite)/i.test(v));
if (placeholder.length) {
  die(`.jira.env ainda tem placeholder em: ${placeholder.map(([k]) => k).join(', ')}`);
}

if (!SITE || !EMAIL || !TOKEN) {
  die(
    'Faltam credenciais. Crie `.jira.env` na raiz do repo (gitignored) com:\n' +
    '  JIRA_SITE=https://<site>.atlassian.net\n' +
    '  JIRA_EMAIL=<e-mail da conta Atlassian>\n' +
    '  JIRA_TOKEN=<token de https://id.atlassian.com/manage-profile/security/api-tokens>\n' +
    'Ou exporte as três como env vars. Nunca commite o arquivo.'
  );
}
if (!/^https:\/\/[^/]+$/.test(SITE)) die(`JIRA_SITE inválido: "${SITE}" — esperado https://<site>.atlassian.net`);

const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

// ─────────────────────────────────────────────────────────── HTTP

let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, { retries = 5 } = {}) {
  const url = `${SITE}${path}`;
  for (let attempt = 0; ; attempt++) {
    calls++;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: AUTH,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      if (attempt >= retries) throw new Error(`${method} ${path} — rede: ${e.message}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) {
        throw new Error(`${method} ${path} — HTTP ${res.status} após ${retries} retries`);
      }
      const ra = Number(res.headers.get('retry-after'));
      await sleep(ra ? ra * 1000 : Math.min(30_000, 500 * 2 ** attempt));
      continue;
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }

    if (!res.ok) {
      const detail =
        json?.errorMessages?.join('; ') ||
        (json?.errors && Object.entries(json.errors).map(([k, v]) => `${k}: ${v}`).join('; ')) ||
        text.slice(0, 400);
      const err = new Error(`HTTP ${res.status} — ${detail}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }
}

async function pool(items, worker, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        out[idx] = { ok: true, value: await worker(items[idx], idx) };
      } catch (e) {
        out[idx] = { ok: false, error: e, item: items[idx] };
      }
    }
  });
  await Promise.all(runners);
  return out;
}

// ─────────────────────────────────────────────────────────── CSV

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignora */ }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}

const invKeyOf = (rec) =>
  (rec.Labels || '').split(',').map((s) => s.trim()).find((s) => s.startsWith('inv:')) || null;

const records = parseCsv(readFileSync(CSV_PATH, 'utf8'));
const PROJECT = opt('project', records[0]?.['Project Key'] || 'TOR');

// integridade do CSV — falha cedo, não no meio de 185 escritas
{
  const ids = new Set(records.map((r) => r['Issue ID']));
  const problems = [];
  if (ids.size !== records.length) problems.push('Issue ID duplicado');
  const keys = records.map(invKeyOf);
  if (keys.some((k) => !k)) problems.push(`${keys.filter((k) => !k).length} linha(s) sem label inv:`);
  if (new Set(keys).size !== keys.length) problems.push('chave inv: duplicada');
  const orphans = records.filter((r) => r['Parent ID'] && !ids.has(r['Parent ID']));
  if (orphans.length) problems.push(`${orphans.length} linha(s) com Parent ID inexistente`);
  if (problems.length) die('CSV inconsistente: ' + problems.join(' · '));
}

const byId = new Map(records.map((r) => [r['Issue ID'], r]));
const parentInvKey = (rec) => (rec['Parent ID'] ? invKeyOf(byId.get(rec['Parent ID'])) : null);

function selected() {
  if (PILOT) {
    return records.filter((r) => {
      const k = invKeyOf(r).slice(4);
      return k === 'EPIC' || k === 'H1' || k.startsWith('H1-');
    });
  }
  if (ONLY.length) {
    return records.filter((r) => {
      const k = invKeyOf(r).slice(4);
      return ONLY.some((o) => k === o || k.startsWith(o + '-'));
    });
  }
  return records;
}

// ordem de criação: pai sempre antes do filho
const TYPE_ORDER = { Epic: 0, Story: 1, 'Sub-task': 2 };
const plan = selected().sort(
  (a, b) => (TYPE_ORDER[a['Issue Type']] ?? 9) - (TYPE_ORDER[b['Issue Type']] ?? 9)
);

// ─────────────────────────────────────────────────────────── ADF

function toAdf(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.length
      ? paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
      : [{ type: 'paragraph', content: [] }],
  };
}

const labelsOf = (rec) =>
  (rec.Labels || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\s+/g, '-')); // label do Jira não aceita espaço

// ─────────────────────────────────────────────────────────── metadados do projeto

const loadMap = (p) => (p ? JSON.parse(readFileSync(resolve(p), 'utf8')) : {});
const statusMap = loadMap(opt('status-map'));
const typeMap = loadMap(opt('type-map'));

async function readMeta() {
  const me = await api('GET', '/rest/api/3/myself');
  const project = await api(
    'GET',
    `/rest/api/3/project/${encodeURIComponent(PROJECT)}?expand=lead,issueTypes`
  );

  let issueTypes = [];
  for (let start = 0; ; start += 50) {
    const page = await api(
      'GET',
      `/rest/api/3/issue/createmeta/${encodeURIComponent(PROJECT)}/issuetypes?startAt=${start}&maxResults=50`
    );
    issueTypes = issueTypes.concat(page.issueTypes || page.values || []);
    if (!page.issueTypes && !page.values) break;
    if (issueTypes.length >= (page.total ?? issueTypes.length)) break;
  }
  if (!issueTypes.length) issueTypes = project.issueTypes || [];

  const statusesByType = await api('GET', `/rest/api/3/project/${encodeURIComponent(PROJECT)}/statuses`);
  return { me, project, issueTypes, statusesByType };
}

/** Resolve "Epic"/"Story"/"Sub-task" do CSV para o issue type real do projeto. */
function resolveTypes(issueTypes) {
  const byName = new Map(issueTypes.map((t) => [t.name.toLowerCase(), t]));
  const pick = (csvName, fallbackFn) => {
    const forced = typeMap[csvName];
    if (forced) {
      const t = byName.get(String(forced).toLowerCase());
      if (!t) die(`--type-map aponta "${csvName}" → "${forced}", que não existe em ${PROJECT}`);
      return { type: t, how: 'type-map' };
    }
    const exact = byName.get(csvName.toLowerCase());
    if (exact) return { type: exact, how: 'nome exato' };
    const guess = issueTypes.find(fallbackFn);
    if (guess) return { type: guess, how: 'hierarquia' };
    return { type: null, how: null };
  };

  return {
    Epic: pick('Epic', (t) => t.hierarchyLevel === 1),
    Story: pick('Story', (t) => !t.subtask && (t.hierarchyLevel ?? 0) === 0),
    'Sub-task': pick('Sub-task', (t) => t.subtask === true || t.hierarchyLevel === -1),
  };
}

/** Nomes de status válidos por issue type, achatado. */
function statusNames(statusesByType) {
  const set = new Set();
  const perType = new Map();
  for (const entry of statusesByType) {
    const names = (entry.statuses || []).map((s) => s.name);
    perType.set(entry.name, names);
    names.forEach((n) => set.add(n));
  }
  return { all: [...set], perType };
}

const targetStatus = (rec) => {
  const raw = rec.Status || '';
  if (!raw) return null;
  return statusMap[raw] ?? raw;
};

// ─────────────────────────────────────────────────────────── índice idempotente

async function searchByJql(jql, fields) {
  const out = [];
  let nextPageToken = null;
  for (;;) {
    const body = { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) };
    let page;
    try {
      page = await api('POST', '/rest/api/3/search/jql', body);
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        // instância antiga: endpoint legado
        page = await api('POST', '/rest/api/3/search', {
          jql, fields, maxResults: 100, startAt: out.length,
        });
        out.push(...(page.issues || []));
        if (out.length >= (page.total ?? out.length)) return out;
        continue;
      }
      throw e;
    }
    out.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
    if (!nextPageToken || page.isLast) return out;
  }
}

/** invKey → issue já existente no Jira. Uma varredura, em lotes de 50 labels. */
async function buildIndex(keys) {
  const index = new Map();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const jql =
      `project = "${PROJECT}" AND labels IN (${chunk.map((k) => `"${k}"`).join(', ')})`;
    const issues = await searchByJql(jql, ['summary', 'status', 'labels', 'issuetype', 'parent']);
    for (const iss of issues) {
      for (const l of iss.fields.labels || []) {
        if (l.startsWith('inv:')) {
          if (index.has(l)) {
            warn(`chave ${l} aparece em ${index.get(l).key} E ${iss.key} — duplicata no Jira, resolva na mão`);
          } else index.set(l, iss);
        }
      }
    }
  }
  return index;
}

// ─────────────────────────────────────────────────────────── escrita

async function createIssue(rec, types, parentKey) {
  const t = types[rec['Issue Type']].type;
  const fields = {
    project: { key: PROJECT },
    issuetype: { id: t.id },
    summary: rec.Summary,
  };
  if (rec.Description) fields.description = toAdf(rec.Description);
  if (SEND_LABELS) fields.labels = labelsOf(rec);
  if (parentKey) fields.parent = { key: parentKey };
  const res = await api('POST', '/rest/api/3/issue', { fields });
  return res.key;
}

async function transitionTo(issueKey, statusName) {
  const { transitions } = await api('GET', `/rest/api/3/issue/${issueKey}/transitions`);
  const hit = transitions.find(
    (tr) => (tr.to?.name || '').toLowerCase() === statusName.toLowerCase()
  );
  if (!hit) {
    return {
      moved: false,
      reason: `sem transição direta para "${statusName}" (disponíveis: ${transitions.map((tr) => tr.to?.name).join(' | ') || 'nenhuma'})`,
    };
  }
  await api('POST', `/rest/api/3/issue/${issueKey}/transitions`, { transition: { id: hit.id } });
  return { moved: true };
}

// ─────────────────────────────────────────────────────────── sprint

/**
 * Acha a sprint ativa do projeto. Sprint só existe em board scrum.
 * Zero ativa ou mais de uma → devolve o motivo e deixa o humano decidir;
 * adivinhar sprint é o tipo de erro que só aparece depois de 185 escritas.
 */
async function findSprint() {
  if (SPRINT_ID) {
    const s = await api('GET', `/rest/agile/1.0/sprint/${encodeURIComponent(SPRINT_ID)}`);
    return { sprint: s, how: '--sprint-id' };
  }

  let boards = [];
  for (let start = 0; ; start += 50) {
    const page = await api(
      'GET',
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(PROJECT)}&startAt=${start}&maxResults=50`
    );
    boards = boards.concat(page.values || []);
    if (page.isLast || !(page.values || []).length) break;
  }
  if (!boards.length) return { sprint: null, reason: `nenhum board encontrado para ${PROJECT}` };

  // Não filtrar por b.type: projeto team-managed (next-gen) reporta board como
  // "simple" e ainda assim tem sprint. Quem não suporta responde 400/404 — pula.
  const seen = new Map();
  const skipped = [];
  for (const b of boards) {
    let page;
    try {
      page = await api('GET', `/rest/agile/1.0/board/${b.id}/sprint?state=active`);
    } catch (e) {
      if (e.status === 400 || e.status === 404) { skipped.push(`${b.name}[${b.type}]`); continue; }
      throw e;
    }
    for (const s of page.values || []) if (!seen.has(s.id)) seen.set(s.id, { ...s, board: b });
  }
  const active = [...seen.values()];
  if (!active.length) {
    return {
      sprint: null,
      reason: `nenhuma sprint ATIVA nos boards de ${PROJECT} (${boards.map((b) => b.name).join(', ')})` +
        (skipped.length ? ` · sem suporte a sprint: ${skipped.join(', ')}` : ''),
    };
  }
  if (active.length > 1) {
    return {
      sprint: null,
      reason: `${active.length} sprints ativas (${active.map((s) => `${s.id}:${s.name}`).join(' | ')}) — use --sprint-id`,
    };
  }
  return { sprint: active[0], how: 'única ativa' };
}

/** Adiciona à sprint. Sub-task é recusada pela API — herda a sprint do pai. */
async function addToSprint(sprintId, issueKeys) {
  const done = [];
  for (let i = 0; i < issueKeys.length; i += 50) {
    const chunk = issueKeys.slice(i, i + 50);
    await api('POST', `/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: chunk });
    done.push(...chunk);
  }
  return done;
}

// ─────────────────────────────────────────────────────────── main

async function main() {
  say(`${C.bold}jira-import${C.reset} ${C.dim}· ${MODE} · projeto ${PROJECT} · ${plan.length}/${records.length} linhas${C.reset}`);
  say(`${C.dim}site ${SITE} · conta ${EMAIL}${C.reset}\n`);

  const meta = await readMeta();
  ok(`autenticado como ${meta.me.displayName} <${meta.me.emailAddress || EMAIL}>`);
  ok(`projeto ${meta.project.key} — "${meta.project.name}" · style=${meta.project.style || '?'} · ${meta.project.projectTypeKey}`);

  // ── tipos
  const types = resolveTypes(meta.issueTypes);
  let fatal = false;
  for (const [csvName, r] of Object.entries(types)) {
    const used = plan.some((p) => p['Issue Type'] === csvName);
    if (!used) continue;
    if (!r.type) { bad(`issue type "${csvName}" não existe em ${PROJECT} — use --type-map`); fatal = true; }
    else if (r.how === 'nome exato') ok(`type ${csvName} → "${r.type.name}" (id ${r.type.id})`);
    else warn(`type ${csvName} → "${r.type.name}" (id ${r.type.id}) resolvido por ${r.how}, não por nome`);
  }
  say(`${C.dim}  types do projeto: ${meta.issueTypes.map((t) => t.name).join(' | ')}${C.reset}`);

  // ── status
  const st = statusNames(meta.statusesByType);
  say(`${C.dim}  status do projeto: ${st.all.join(' | ')}${C.reset}`);
  const wanted = [...new Set(plan.map(targetStatus).filter(Boolean))];
  for (const w of wanted) {
    if (st.all.some((s) => s.toLowerCase() === w.toLowerCase())) ok(`status "${w}" existe`);
    else { bad(`status "${w}" NÃO existe em ${PROJECT} — use --status-map`); fatal = true; }
  }
  const semStatus = plan.filter((r) => !r.Status);
  if (semStatus.length) {
    warn(`${semStatus.length} linha(s) sem Status no CSV — nascem no status inicial do workflow e não são movidas: ${semStatus.map(invKeyOf).join(', ')}`);
  }

  // ── sprint
  let sprintInfo = { sprint: null, reason: '--no-sprint' };
  if (WANT_SPRINT) {
    sprintInfo = await findSprint();
    if (sprintInfo.sprint) {
      const s = sprintInfo.sprint;
      ok(`sprint ${s.id} — "${s.name}" (${s.state}${s.endDate ? `, termina ${s.endDate.slice(0, 10)}` : ''}) via ${sprintInfo.how}`);
      const nSub = plan.filter((r) => r['Issue Type'] === 'Sub-task').length;
      const nTop = plan.length - nSub;
      say(`${C.dim}  ${nTop} issue(s) de topo entram na sprint · ${nSub} sub-task(s) herdam a do pai (a API recusa sub-task em sprint)${C.reset}`);
    } else {
      bad(`sprint: ${sprintInfo.reason}`);
      fatal = true;
    }
  }

  if (fatal) die('divergência de metadados. Nada foi criado. Corrija os mapas e rode de novo.');
  if (MODE === 'preflight') { ok(`preflight limpo — o CSV casa com o ${PROJECT}.`); return; }

  // ── índice do que já existe
  const keys = plan.map(invKeyOf);
  const index = await buildIndex(keys);
  const existing = keys.filter((k) => index.has(k)).length;
  say(`\n${C.blue}índice${C.reset}: ${existing}/${keys.length} chaves já existem no Jira`);

  if (MODE === 'report') {
    await report(st);
    return;
  }

  // ── plano
  const actions = plan.map((rec) => {
    const key = invKeyOf(rec);
    const found = index.get(key);
    return {
      rec, key, found,
      action: found ? 'reconciliar' : 'criar',
      target: targetStatus(rec),
      current: found?.fields?.status?.name || null,
    };
  });

  const toCreate = actions.filter((a) => a.action === 'criar').length;
  const toMove = actions.filter(
    (a) => a.target && (!a.current || a.current.toLowerCase() !== a.target.toLowerCase())
  ).length;
  say(`${C.blue}plano${C.reset}: criar ${toCreate} · reconciliar ${actions.length - toCreate} · transicionar ~${toMove}\n`);

  if (MODE === 'dry-run') {
    for (const a of actions) {
      const arrow = a.target ? `→ ${a.target}` : '(sem status)';
      say(`  ${a.action === 'criar' ? C.green + 'criar     ' : C.dim + 'reconciliar'}${C.reset} ${a.key.padEnd(12)} ${arrow.padEnd(16)} ${a.rec.Summary.slice(0, 68)}`);
    }
    say(`\n${C.yellow}dry-run — nada foi escrito.${C.reset} Repita com --apply.`);
    return;
  }

  // ── APPLY: cria em ondas (Epic → Story → Sub-task) pra o pai existir antes do filho
  const keyToJira = new Map([...index].map(([k, v]) => [k, v.key]));
  const results = [];

  for (const tier of ['Epic', 'Story', 'Sub-task']) {
    const wave = actions.filter((a) => a.rec['Issue Type'] === tier);
    if (!wave.length) continue;
    say(`${C.bold}onda ${tier}${C.reset} (${wave.length})`);

    const out = await pool(wave, async (a) => {
      if (a.found) {
        keyToJira.set(a.key, a.found.key);
        return { ...a, jiraKey: a.found.key, created: false };
      }
      const pk = parentInvKey(a.rec);
      const parentJira = pk ? keyToJira.get(pk) : null;
      if (pk && !parentJira) throw new Error(`pai ${pk} não resolvido`);
      const jiraKey = await createIssue(a.rec, types, parentJira);
      keyToJira.set(a.key, jiraKey);
      return { ...a, jiraKey, created: true };
    });

    for (const r of out) {
      if (r.ok) {
        results.push(r.value);
        say(`  ${r.value.created ? C.green + 'criado' : C.dim + 'existe'}${C.reset} ${r.value.jiraKey.padEnd(10)} ${r.value.key}`);
      } else {
        results.push({ ...r.item, error: r.error.message });
        bad(`${r.item.key} — ${r.error.message}`);
      }
    }
  }

  // ── sprint: só issue de topo; sub-task herda do pai
  const sprintAdded = [];
  if (WANT_SPRINT && sprintInfo.sprint) {
    const sid = sprintInfo.sprint.id;
    const stories = results.filter((r) => r.jiraKey && r.rec['Issue Type'] === 'Story').map((r) => r.jiraKey);
    const epics = results.filter((r) => r.jiraKey && r.rec['Issue Type'] === 'Epic').map((r) => r.jiraKey);
    say(`\n${C.bold}sprint ${sid} — "${sprintInfo.sprint.name}"${C.reset}`);

    if (stories.length) {
      try {
        sprintAdded.push(...(await addToSprint(sid, stories)));
        ok(`${stories.length} story(s) na sprint`);
      } catch (e) {
        bad(`falha ao pôr stories na sprint: ${e.message}`);
      }
    }
    // Epic normalmente vive acima da sprint; tenta, mas recusa não derruba a rodada.
    if (epics.length) {
      try {
        sprintAdded.push(...(await addToSprint(sid, epics)));
        ok(`epic na sprint`);
      } catch (e) {
        warn(`epic ficou fora da sprint (${e.message}) — esperado: epic é camada acima, as stories é que dão o alinhamento`);
      }
    }
    const nSub = results.filter((r) => r.jiraKey && r.rec['Issue Type'] === 'Sub-task').length;
    if (nSub) say(`${C.dim}  ${nSub} sub-task(s) não são adicionadas direto — aparecem na sprint sob a story pai${C.reset}`);
  }

  // ── transições
  if (DO_TRANSITIONS) {
    const needMove = results.filter(
      (r) => r.jiraKey && r.target && (!r.current || r.current.toLowerCase() !== r.target.toLowerCase())
    );
    say(`\n${C.bold}transições${C.reset} (${needMove.length})`);
    const out = await pool(needMove, async (r) => ({ r, res: await transitionTo(r.jiraKey, r.target) }));
    for (const o of out) {
      if (!o.ok) { bad(`${o.item.jiraKey} — ${o.error.message}`); o.item.transitionError = o.error.message; continue; }
      if (o.value.res.moved) say(`  ${C.green}movido${C.reset} ${o.value.r.jiraKey} → ${o.value.r.target}`);
      else { warn(`${o.value.r.jiraKey}: ${o.value.res.reason}`); o.value.r.transitionError = o.value.res.reason; }
    }
  }

  // ── relatório
  const created = results.filter((r) => r.created).length;
  const reused = results.filter((r) => r.jiraKey && !r.created).length;
  const failed = results.filter((r) => r.error);
  const stuck = results.filter((r) => r.transitionError);

  say(`\n${C.bold}resumo${C.reset}`);
  say(`  criadas       ${created}`);
  say(`  reaproveitadas${String(reused).padStart(3)}`);
  say(`  falhas        ${failed.length}`);
  say(`  sem transição ${stuck.length}`);
  say(`  na sprint     ${sprintAdded.length}`);
  say(`  chamadas HTTP ${calls}`);

  const outPath = resolve('.specs/project/jira-import-report.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        site: SITE, project: PROJECT, mode: MODE, pilot: PILOT, only: ONLY,
        sprint: sprintInfo.sprint
          ? { id: sprintInfo.sprint.id, name: sprintInfo.sprint.name, added: sprintAdded }
          : { skipped: sprintInfo.reason },
        created, reused, failed: failed.map((f) => ({ key: f.key, error: f.error })),
        stuck: stuck.map((s) => ({ key: s.key, jiraKey: s.jiraKey, reason: s.transitionError })),
        map: Object.fromEntries(results.filter((r) => r.jiraKey).map((r) => [r.key, r.jiraKey])),
      },
      null, 2
    )
  );
  say(`  relatório     ${outPath}`);

  await report(st);
  if (failed.length) process.exitCode = 1;
}

async function report(st) {
  say(`\n${C.bold}contagem por status (JQL, só as issues do inventário)${C.reset}`);
  const keys = records.map(invKeyOf);
  const counts = new Map();
  let total = 0;
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const jql = `project = "${PROJECT}" AND labels IN (${chunk.map((k) => `"${k}"`).join(', ')})`;
    const issues = await searchByJql(jql, ['status']);
    for (const iss of issues) {
      const n = iss.fields.status?.name || '(?)';
      counts.set(n, (counts.get(n) || 0) + 1);
      total++;
    }
  }
  const expected = new Map();
  for (const r of records) {
    const t = targetStatus(r);
    if (t) expected.set(t, (expected.get(t) || 0) + 1);
  }
  for (const name of new Set([...counts.keys(), ...expected.keys()])) {
    const got = counts.get(name) || 0;
    const exp = expected.get(name);
    const mark = exp === undefined ? C.dim + '·' : got === exp ? C.green + '✔' : C.red + '✖';
    say(`  ${mark}${C.reset} ${name.padEnd(14)} ${String(got).padStart(4)}${exp !== undefined ? ` / esperado ${exp}` : ''}`);
  }
  say(`  ${C.dim}total no Jira ${total} / ${records.length} no CSV${C.reset}`);
}

main().catch((e) => {
  bad(e.message);
  if (e.status === 401) say(`${C.dim}401 = e-mail ou token inválido. Token: https://id.atlassian.com/manage-profile/security/api-tokens${C.reset}`);
  if (e.status === 403) say(`${C.dim}403 = conta autenticou mas não tem permissão de criar em ${PROJECT}.${C.reset}`);
  if (e.status === 404) say(`${C.dim}404 = projeto ${PROJECT} não existe nesse site, ou a conta não o enxerga.${C.reset}`);
  process.exit(1);
});
