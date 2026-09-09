/**
 * Roda uma suíte pgTAP numa branch de preview pela Management API e mostra
 * QUAIS asserções falharam.
 *
 * Por que instrumentar: a Management API devolve apenas o resultado da ÚLTIMA
 * query do lote. Sem isso, `finish()` diz "failed 2 of 81" e não diz quais —
 * que é indistinguível de não ter rodado, para efeito de conserto.
 *
 * A instrumentação troca cada `SELECT <assert>(` por
 * `INSERT INTO _tap(l) SELECT <assert>(`, coleta tudo numa temp table e termina
 * com um SELECT que devolve as linhas na ordem, marcando as que não começam
 * com "ok ".
 *
 * Uso: node run-pgtap.mjs --ref <ref> --file <caminho.sql>
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };

const ref = arg('--ref');
const file = arg('--file');
if (!ref || !file) { console.error('uso: --ref <ref> --file <caminho.sql>'); process.exit(1); }
if (ref === 'jsjsmuncfkbsbzqzqhfq') { console.error('RECUSADO: ref de PRODUÇÃO.'); process.exit(1); }

let token = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, erro: `HTTP ${res.status}: ${body.slice(0, 4000)}` };
  try { return { ok: true, rows: JSON.parse(body) }; }
  catch { return { ok: true, rows: body }; }
}

const bruto = readFileSync(file, 'utf8');

// Asserções pgTAP que esta suíte usa. Só troca no INÍCIO de statement.
const ASSERTS = 'ok|is|isnt|throws_ok|lives_ok|results_eq|results_ne|set_eq|set_ne|bag_eq|has_function|hasnt_function|matches|imatches|cmp_ok|is_empty|isa_ok|has_table|has_column|function_returns|todo|skip|pass|fail';
const reAssert = new RegExp(`^([ \\t]*)SELECT\\s+(${ASSERTS})\\s*\\(`, 'gim');

let n = 0;
let sql = bruto.replace(reAssert, (m, indent, fn) => { n++; return `${indent}INSERT INTO _tap(l) SELECT ${fn}(`; });

// A temp table nasce logo depois do plan(); authenticated precisa poder gravar,
// porque metade das asserções roda sob esse papel.
sql = sql.replace(/SELECT\s+plan\(\s*\d+\s*\);/i, (m) =>
  `${m}\nCREATE TEMP TABLE _tap(ord serial, l text);\nGRANT USAGE, SELECT, UPDATE ON SEQUENCE _tap_ord_seq TO authenticated;\nGRANT INSERT, SELECT ON _tap TO authenticated;`);

// finish() também vira linha coletada, e o retorno do lote passa a ser o relatório.
sql = sql.replace(/SELECT\s+\*\s+FROM\s+finish\(\)\s*;/i,
  `INSERT INTO _tap(l) SELECT * FROM finish();
RESET ROLE;
SELECT ord, l, (l LIKE 'ok %') AS passou FROM _tap ORDER BY ord;`);

console.error(`instrumentadas ${n} asserções`);

const r = await query(sql);
if (!r.ok) { console.error(r.erro); process.exit(1); }

const rows = Array.isArray(r.rows) ? r.rows : [];
if (!rows.length) { console.log('SEM LINHAS DE VOLTA — a suíte não chegou ao relatório:'); console.log(JSON.stringify(r.rows).slice(0, 4000)); process.exit(1); }

const falhas = rows.filter((x) => x.passou === false && !/^#/.test(String(x.l || '')));
const oks = rows.filter((x) => x.passou === true);

console.log(`\n=== RESULTADO: ${oks.length} passaram, ${falhas.length} falharam, ${rows.length} linhas ===\n`);
for (const f of falhas) console.log(`FALHOU [${f.ord}] ${f.l}`);
if (!falhas.length) console.log('nenhuma falha.');
process.exit(falhas.length ? 2 : 0);
