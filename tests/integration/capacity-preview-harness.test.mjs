import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { buildCapacityPreviewValidation } from '../../scripts/build-capacity-preview-validation.mjs';

test('remote harness validates original DDL and mocked behavior without touching protected net', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA net;
      CREATE FUNCTION net.http_post(url text) RETURNS bigint LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Real network transport must never be invoked'; END $$;`);
    const before = await db.query("SELECT pg_get_functiondef('net.http_post(text)'::regprocedure) AS definition");
    const sql = buildCapacityPreviewValidation();
    assert.doesNotMatch(sql, /CREATE(?: OR REPLACE)? FUNCTION net\.|CREATE SCHEMA(?: IF NOT EXISTS)? net;/);
    const results = await db.exec(sql);
    assert.ok(results.some(result => result.rows?.some(row => String(row.validation).startsWith('PASS:'))));
    assert.deepEqual((await db.query("SELECT pg_get_functiondef('net.http_post(text)'::regprocedure) AS definition")).rows, before.rows);
    assert.equal((await db.query("SELECT to_regclass('public.cron_config') AS fixture, to_regnamespace('capacity_test_net') AS mock")).rows[0].fixture, null);
    assert.equal((await db.query("SELECT to_regnamespace('capacity_test_net') AS mock")).rows[0].mock, null);
  } finally { await db.close(); }
});
