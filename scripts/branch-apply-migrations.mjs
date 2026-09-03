/**
 * Aplica as migrations do repo numa branch de preview, pela Management API.
 *
 * POR QUE NÃO `supabase db push`
 * ------------------------------
 * `db push` fala Postgres pelo `db.<ref>`, e a branch de preview não é
 * alcançável por psql desta máquina (ver o cabeçalho de `branch-sql.mjs`). A
 * Management API é a única porta. Este script é o `db push` que falta: itera os
 * arquivos EM ORDEM e posta cada um, escrevendo o ledger conforme avança.
 *
 * A branch nasce VAZIA (0 tabelas, sem `supabase_migrations`), então não há
 * ledger fantasma para apagar — o problema que `supabase-branch.sh` conserta
 * não aparece por este caminho.
 *
 * Migrations que dependem de `storage.buckets`/`storage.objects` falham: a
 * branch não provisiona o schema `storage`. São esperadas e ficam listadas ao
 * final em vez de abortar o replay — abortar deixaria a branch pior que
 * inservível, deixaria ela PELA METADE sem dizer onde parou.
 *
 * Uso: node scripts/branch-apply-migrations.mjs --ref <ref>
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const i = argv.indexOf('--ref');
const ref = i === -1 ? process.env.SUPABASE_BRANCH_REF : argv[i + 1];
if (!ref) { console.error('missing --ref <ref>'); process.exit(1); }
if (ref === 'jsjsmuncfkbsbzqzqhfq') {
  console.error('RECUSADO: esse é o ref de PRODUÇÃO.');
  process.exit(1);
}

let token = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}

const DIR = 'supabase/migrations';
// Só a raiz: `archive/` não replaya e `rollback/` desfaz.
const arquivos = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.sql'))
  .map((d) => d.name)
  .sort();

async function rodar(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300));
  return res.json();
}

await rodar(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY, statements text[], name text);`);

const falhas = [];
let ok = 0;
for (const nome of arquivos) {
  const versao = nome.split('_')[0];
  const sql = readFileSync(join(DIR, nome), 'utf8');
  try {
    await rodar(sql);
    await rodar(
      `INSERT INTO supabase_migrations.schema_migrations (version, name)
       VALUES ('${versao}', '${nome.replace(/'/g, "''")}')
       ON CONFLICT (version) DO NOTHING;`,
    );
    ok++;
    process.stdout.write(`ok   ${nome}\n`);
  } catch (e) {
    falhas.push({ nome, erro: String(e.message).replace(/\s+/g, ' ').slice(0, 200) });
    process.stdout.write(`FALHA ${nome}\n       ${falhas.at(-1).erro}\n`);
  }
}

const [{ n: tabelas }] = await rodar(`select count(*) n from pg_tables where schemaname='public'`);
console.log(`\n== ${ok}/${arquivos.length} aplicadas | ${tabelas} tabelas em public ==`);
if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  for (const f of falhas) console.log(`  - ${f.nome}\n      ${f.erro}`);
}
