import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
const prerequisiteName = '20260916163243_bulk_move_replay_prerequisite.sql';
const consumerName = '20260916163244_bulk_move_existing_pipeline_entries.sql';
const producerName = '20271019000007_deal_transfer_history.sql';
const sql = name => readFileSync(new URL(name, migrationDirectory), 'utf8');
const baselineTable = sql('20260101000000_baseline_prod_schema.sql')
  .match(/CREATE TABLE IF NOT EXISTS "public"\."pipeline_stage_events" \([\s\S]*?\n\);/)?.[0];
const laterColumns = sql(producerName).match(/ALTER TABLE public\.pipeline_stage_events[\s\S]*?;/)?.[0];
assert.ok(baselineTable, 'use the real baseline table rather than a reconstructed schema');
assert.ok(laterColumns, 'use the later producer column definitions');

const orgA = '00000000-0000-4000-8000-000000000001';
const orgB = '00000000-0000-4000-8000-000000000002';
const lead = '00000000-0000-4000-8000-000000000003';
const pipelineA = '00000000-0000-4000-8000-000000000004';
const pipelineB = '00000000-0000-4000-8000-000000000005';

async function database() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; ${baselineTable}`);
  return db;
}

test('fresh replay puts the missing column before the real bulk-move consumer and preserves transition checks', async () => {
  const order = readdirSync(migrationDirectory).filter(name => /^\d{14}_.*\.sql$/.test(name)).sort();
  assert.equal(order[order.indexOf(prerequisiteName) + 1], consumerName);
  const db = await database();
  try {
    await assert.rejects(db.transaction(tx => tx.exec(sql(consumerName))), error =>
      error.code === '42703' && error.message.includes('from_pipeline_id'));
    await db.exec(sql(prerequisiteName));
    await db.exec(sql(consumerName));
    await db.query(`INSERT INTO pipeline_stage_events
      (organization_id,lead_id,pipeline_id,from_pipeline_id,from_stage_key,to_stage_key)
      VALUES ($1,$2,$3,$4,'novo','novo')`, [orgA, lead, pipelineB, pipelineA]);
    await assert.rejects(db.query(`INSERT INTO pipeline_stage_events
      (organization_id,lead_id,pipeline_id,from_pipeline_id,from_stage_key,to_stage_key)
      VALUES ($1,$2,$3,$3,'novo','novo')`, [orgA, lead, pipelineA]), error => error.code === '23514');
    await assert.rejects(db.query(`INSERT INTO pipeline_stage_events
      (organization_id,lead_id,pipeline_id,from_stage_key,to_stage_key)
      VALUES ($1,$2,$3,'novo','novo')`, [orgA, lead, pipelineA]), error => error.code === '23514');
    // A later historical migration still adds its other snapshots and keeps this column.
    await db.exec(laterColumns);
    assert.equal((await db.query('SELECT from_pipeline_id FROM pipeline_stage_events')).rows[0].from_pipeline_id, pipelineA);
  } finally { await db.close(); }
});

test('an existing column remains a no-op: values, grants, RLS and policies survive repeated application', async () => {
  const db = await database();
  try {
    await db.exec(laterColumns);
    await db.exec(`ALTER TABLE pipeline_stage_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY org_scope ON pipeline_stage_events FOR ALL TO authenticated
        USING (organization_id='${orgA}') WITH CHECK (organization_id='${orgA}');
      GRANT SELECT,INSERT ON pipeline_stage_events TO authenticated;`);
    await db.query(`INSERT INTO pipeline_stage_events
      (organization_id,lead_id,pipeline_id,from_pipeline_id,from_stage_key,to_stage_key)
      VALUES ($1,$3,$4,$5,'novo','contato'),($2,$3,$4,$5,'novo','contato')`, [orgA,orgB,lead,pipelineB,pipelineA]);
    const tableState = () => db.query(`SELECT relrowsecurity,relacl::text FROM pg_class WHERE oid='pipeline_stage_events'::regclass`);
    const policies = () => db.query(`SELECT policyname,roles,cmd,qual,with_check FROM pg_policies WHERE tablename='pipeline_stage_events' ORDER BY policyname`);
    const beforeRows = (await db.query('SELECT * FROM pipeline_stage_events ORDER BY organization_id')).rows;
    const beforeTable = (await tableState()).rows;
    const beforePolicies = (await policies()).rows;
    await db.exec(sql(prerequisiteName));
    await db.exec(sql(prerequisiteName));
    assert.deepEqual((await db.query('SELECT * FROM pipeline_stage_events ORDER BY organization_id')).rows, beforeRows);
    assert.deepEqual((await tableState()).rows, beforeTable);
    assert.deepEqual((await policies()).rows, beforePolicies);
    await db.exec('SET ROLE authenticated');
    assert.deepEqual((await db.query('SELECT organization_id,from_pipeline_id FROM pipeline_stage_events')).rows,
      [{ organization_id: orgA, from_pipeline_id: pipelineA }]);
    await assert.rejects(db.query(`INSERT INTO pipeline_stage_events
      (organization_id,lead_id,pipeline_id,from_stage_key,to_stage_key)
      VALUES ($1,$2,$3,'novo','contato')`, [orgB,lead,pipelineA]), error => error.code === '42501');
  } finally { await db.close(); }
});
