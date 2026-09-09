// PostgreSQL isolado (PGlite). Não conecta ao Supabase nem usa dados de clientes.
// npm install --prefix <pasta-temporaria> @electric-sql/pglite@0.3.14
// PGLITE_MODULE=<file URL de dist/index.js> node scripts/test-reorder-pipeline-stages.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const migration = '20271019000002_fix_reorder_pipeline_stages_reserved_positions.sql';
const load = (path) => readFile(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const reorder = (ids) => db.query('select reorder_pipeline_stages($1::uuid[]) as changed', [ids]);
const positions = async () => (await db.query('select id, position, is_active from pipeline_stages order by id')).rows;
let checks = 0;
async function check(name, test) {
  await test();
  checks++;
  console.log(`PASS ${name}`);
}
async function rejects(ids, code) {
  const before = await positions();
  await assert.rejects(reorder(ids), (error) => error.code === code);
  assert.deepEqual(await positions(), before);
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.pipeline_stages (
      id uuid PRIMARY KEY, pipeline_id uuid NOT NULL,
      position integer NOT NULL, is_active boolean NOT NULL,
      updated_at timestamptz,
      UNIQUE(pipeline_id,position) DEFERRABLE INITIALLY IMMEDIATE
    );
    INSERT INTO pipeline_stages VALUES
      ('${id(1)}','${id(10)}',0,true,null),
      ('${id(2)}','${id(10)}',1,false,null),
      ('${id(3)}','${id(10)}',2,true,null),
      ('${id(4)}','${id(20)}',0,true,null),
      ('${id(5)}','${id(20)}',1,true,null);
  `);
  // A definição real anterior é também o rollback entregue com a correção.
  await db.exec(await load(`rollback/${migration}`));
  await check('reprodução anterior: etapa inativa causa 23505', () => rejects([id(3), id(1)], '23505'));
  await db.exec(await load(migration));

  await check('reordena ativas preservando a posição da etapa desativada', async () => {
    assert.equal((await reorder([id(3), id(1)])).rows[0].changed, 2);
    assert.deepEqual((await positions()).map((s) => s.position), [2, 1, 0, 0, 1]);
  });
  await check('reordenação repetida não modifica linhas', async () => {
    assert.equal((await reorder([id(3), id(1)])).rows[0].changed, 0);
  });
  await check('funil sem etapas desativadas continua reordenando', async () => {
    assert.equal((await reorder([id(5), id(4)])).rows[0].changed, 2);
  });
  await check('subconjunto não ocupa posições de etapas omitidas', async () => {
    assert.equal((await reorder([id(1)])).rows[0].changed, 0);
    assert.equal((await positions())[0].position, 2);
  });
  await check('lista vazia e nula são no-op', async () => {
    assert.equal((await reorder([])).rows[0].changed, 0);
    assert.equal((await reorder(null)).rows[0].changed, 0);
  });
  await check('rejeita IDs duplicados, nulos, ausentes e funis misturados sem escrita parcial', async () => {
    for (const ids of [[id(1), id(1)], [id(1), null], [id(99)], [id(1), id(4)]]) {
      await rejects(ids, '22023');
    }
  });

  await db.exec(`
    ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, UPDATE ON pipeline_stages TO authenticated;
    CREATE POLICY stage_read ON pipeline_stages FOR SELECT TO authenticated
      USING (pipeline_id = '${id(10)}');
    CREATE POLICY stage_write ON pipeline_stages FOR UPDATE TO authenticated
      USING (pipeline_id = '${id(10)}') WITH CHECK (pipeline_id = '${id(10)}');
    SET ROLE authenticated;
  `);
  await check('membro autorizado reordena sob RLS', async () => {
    assert.equal((await reorder([id(1), id(3)])).rows[0].changed, 2);
  });
  await check('RLS impede acesso a etapas de outro funil/tenant', () => rejects([id(4), id(5)], '22023'));
  await db.exec(`RESET ROLE; DROP POLICY stage_write ON pipeline_stages; SET ROLE authenticated;`);
  await check('sem UPDATE não retorna sucesso falso', () => rejects([id(3), id(1)], '42501'));
  await db.exec('RESET ROLE; SET ROLE anon;');
  await check('anônimo não pode executar a RPC', async () => {
    await assert.rejects(reorder([id(1)]), (error) => error.code === '42501');
  });
  await db.exec('RESET ROLE;');
  await db.exec(await load(`rollback/${migration}`));
  await check('rollback restaura exatamente a falha anterior', () => rejects([id(3), id(1)], '23505'));
  await db.exec(await load(migration));
  await check('reaplicação volta a corrigir a falha', async () => {
    assert.equal((await reorder([id(3), id(1)])).rows[0].changed, 2);
  });
  console.log(`${checks} verificações passaram.`);
} finally {
  await db.close();
}
