/**
 * Integration test: assert_hml_safe.sql (HML slice #614)
 *
 * The fail-closed guard must PASS on a neutralized database and FAIL (throw)
 * the moment any single outbound vector is left live.
 *
 * Prerequisites:
 *   1. `supabase start` running (Postgres at localhost:54322)
 *   2. supabase/seed.sql loaded (provides the fixed test org)
 *
 * Runs the real .sql files via a direct pg connection. A failing guard surfaces
 * as a rejected query (RAISE EXCEPTION), which is the observable behavior.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PG_CONN =
  process.env.PG_CONN || 'postgres://postgres:postgres@localhost:54322/postgres';

const sql = (name: string) =>
  readFileSync(resolve(process.cwd(), 'scripts/hml', name), 'utf8');

const NEUTRALIZE_SQL = sql('neutralize_hml.sql');
const ASSERT_SQL = sql('assert_hml_safe.sql');

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

let pg: Client;

const runNeutralize = () => pg.query(NEUTRALIZE_SQL);
const runAssert = () => pg.query(ASSERT_SQL);

async function createInstance(suffix: string): Promise<string> {
  const res = await pg.query(
    `insert into public.whatsapp_instances (instance_name, organization_id)
     values ($1, $2) returning id`,
    [`hml-assert-${suffix}`, TEST_ORG_ID],
  );
  return res.rows[0].id;
}

describe('assert_hml_safe.sql', () => {
  beforeAll(async () => {
    pg = new Client({ connectionString: PG_CONN });
    await pg.connect();
    // Bypass row-level triggers (e.g. enforce_whatsapp_instance_limit) for seeds.
    await pg.query(`SET session_replication_role = 'replica'`);
  });

  afterAll(async () => {
    await pg?.end();
  });

  // Start every case from a known-safe (neutralized) baseline.
  beforeEach(async () => {
    await runNeutralize();
  });

  it('passes on a neutralized database', async () => {
    await expect(runAssert()).resolves.toBeDefined();
  });

  it('fails when WhatsApp credentials remain', async () => {
    const instanceId = await createInstance(`secret-${Date.now()}`);
    await pg.query(
      `insert into public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token)
       values ($1, $2, $3)`,
      [instanceId, TEST_ORG_ID, 'token-left-behind'],
    );

    await expect(runAssert()).rejects.toThrow(/whatsapp_instance_secrets/);
  });

  it('fails when cron_config still points at prod', async () => {
    await pg.query(
      `insert into public.cron_config (key, value)
       values ('hml_assert_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/x')
       on conflict (key) do update set value = excluded.value`,
    );

    await expect(runAssert()).rejects.toThrow(/point at prod/);
  });

  it('fails when an active cron job remains (when pg_cron is present)', async () => {
    const hasCron = await pg.query(`select to_regclass('cron.job') as reg`);
    if (!hasCron.rows[0].reg) return; // pg_cron not installed — nothing to assert

    await pg.query(`select cron.schedule('hml-assert-job', '* * * * *', 'select 1')`);

    await expect(runAssert()).rejects.toThrow(/active cron job/);
  });
});
