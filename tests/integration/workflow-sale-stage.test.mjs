import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const oldSql = read('supabase/migrations/20270909000010_venda_sem_valor_para_de_passar.sql');
const fixPath = 'supabase/migrations/20271021000020_scope_sale_guard_to_pipeline.sql';
const schema = `CREATE TABLE pipeline_stages(id int, organization_id int, pipeline_id int, stage_key text, stage_role text, is_active boolean, requires_sale_value boolean);
CREATE TABLE pipeline_entries(id int PRIMARY KEY, organization_id int, pipeline_id int, stage_id int, stage_key text, metadata jsonb DEFAULT '{}');
INSERT INTO pipeline_stages VALUES (1,1,10,'em_andamento','open',true,false),(2,1,20,'em_andamento','won',true,true),(3,2,10,'outro','won',true,true);

CREATE TRIGGER trg_pe_stage_mirror BEFORE INSERT OR UPDATE ON pipeline_entries FOR EACH ROW EXECUTE FUNCTION pipeline_entries_stage_mirror();`;

async function database(fixed) {
  const db = new PGlite();
  await db.exec(schema.split('CREATE TRIGGER')[0]);
  const mirror = read('supabase/migrations/20270906002000_cards_apontam_etapa_por_uuid.sql').match(/CREATE OR REPLACE FUNCTION public\.pipeline_entries_stage_mirror\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(mirror);
  await db.exec(mirror);
  await db.exec('CREATE TRIGGER' + schema.split('CREATE TRIGGER')[1]);
  await db.exec(oldSql.slice(oldSql.indexOf('CREATE OR REPLACE FUNCTION'), oldSql.indexOf('-- ── 2.')));
  if (fixed) await db.exec(read(fixPath));
  return db;
}

test('baseline reproduces the cross-pipeline false sale requirement', async () => {
  const db = await database(false);
  try { await assert.rejects(db.exec("INSERT INTO pipeline_entries VALUES (1,1,10,1,'em_andamento','{}')"), /Informe o valor/); }
  finally { await db.close(); }
});

test('follow-up allows missing value, won blocks missing value, tenant and pipeline stay isolated', async () => {
  const db = await database(true);
  try {
    await db.exec("INSERT INTO pipeline_entries VALUES (1,1,10,1,'em_andamento','{}'),(2,1,10,NULL,'outro','{}')");
    await assert.rejects(db.exec("INSERT INTO pipeline_entries VALUES (3,1,20,2,'em_andamento','{}')"), /Informe o valor/);
    await assert.rejects(db.exec("UPDATE pipeline_entries SET pipeline_id=20,stage_id=2 WHERE id=1"), /Informe o valor/);
    await assert.rejects(db.exec("INSERT INTO pipeline_entries VALUES (3,1,20,2,'em_andamento','{\"sale_value\":\"abc\"}')"), /não é um número/);
    await db.exec("INSERT INTO pipeline_entries VALUES (3,1,20,2,'em_andamento','{\"sale_value\":0}')");
    await db.exec("UPDATE pipeline_entries SET metadata='{}' WHERE id=3");
    await db.exec("UPDATE pipeline_entries SET metadata='{\"sale_value\":12.50}',pipeline_id=20,stage_id=2 WHERE id=1");
  } finally { await db.close(); }
});

test('stage-id-only movement is checked after the mirror; rollback reinstates the original function', async () => {
  const db = await database(true);
  try {
    await db.exec("INSERT INTO pipeline_entries VALUES (1,1,20,NULL,'initial','{}')");
    await assert.rejects(db.exec('UPDATE pipeline_entries SET stage_id=2 WHERE id=1'), /Informe o valor/);
    await assert.rejects(db.exec("UPDATE pipeline_entries SET stage_key='em_andamento' WHERE id=1"), /Informe o valor/);
    await assert.rejects(db.exec("INSERT INTO pipeline_entries(id,organization_id,pipeline_id,stage_id) VALUES (3,1,20,2)"), /Informe o valor/);
    await db.exec("INSERT INTO pipeline_entries VALUES (4,1,10,1,'em_andamento','{}')");
    await assert.rejects(db.exec('UPDATE pipeline_entries SET pipeline_id=20 WHERE id=4'), /Informe o valor/);
    await db.exec(read('tests/fixtures/workflow-sale-stage-rollback.sql'));
    await assert.rejects(db.exec("INSERT INTO pipeline_entries VALUES (2,1,10,1,'em_andamento','{}')"), /Informe o valor/);
  } finally { await db.close(); }
});
