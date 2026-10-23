import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync(new URL('../../supabase/migrations/20271021000038_button_ingress_normaliza_telefone.sql', import.meta.url), 'utf8');

test('button ingress phone normalization migration is valid SQL and rejects an empty ingress', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE workflow_button_questions(id uuid);
      CREATE TABLE workflow_button_ingress(id uuid);
      CREATE TABLE workflow_executions(id uuid);
      CREATE TABLE whatsapp_instances(id uuid, organization_id uuid);
    `);
    await db.exec(sql);
    const result = await db.query("SELECT register_workflow_button_ingress(NULL,NULL,'{}'::jsonb) AS result");
    assert.deepEqual(result.rows[0].result, { recognized: false });
  } finally { await db.close(); }
});
