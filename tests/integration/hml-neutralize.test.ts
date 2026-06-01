/**
 * Integration test: neutralize_hml.sql (HML slice #613)
 *
 * Verifies the neutralize script severs every outbound vector after a prod
 * restore, making the database safe for homologation (HML) use.
 *
 * Prerequisites:
 *   1. `supabase start` running (Postgres at localhost:54322)
 *   2. supabase/seed.sql loaded (provides the fixed test org + users)
 *
 * Executes the real .sql file (the public interface) via a direct pg
 * connection, then asserts observable DB state — not implementation details.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PG_CONN =
  process.env.PG_CONN || 'postgres://postgres:postgres@localhost:54322/postgres';

const NEUTRALIZE_SQL = readFileSync(
  resolve(process.cwd(), 'scripts/hml/neutralize_hml.sql'),
  'utf8',
);

// Fixed fixtures from supabase/seed.sql
const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
const TEST_MASTER_ID = '00000000-0000-0000-0000-000000000010';

let pg: Client;

async function runNeutralize() {
  await pg.query(NEUTRALIZE_SQL);
}

/** Creates a whatsapp_instances row and returns its id (FK parent). */
async function createInstance(suffix: string): Promise<string> {
  const res = await pg.query(
    `insert into public.whatsapp_instances (instance_name, organization_id)
     values ($1, $2) returning id`,
    [`hml-test-${suffix}`, TEST_ORG_ID],
  );
  return res.rows[0].id;
}

describe('neutralize_hml.sql', () => {
  beforeAll(async () => {
    pg = new Client({ connectionString: PG_CONN });
    await pg.connect();
  });

  afterAll(async () => {
    await pg?.end();
  });

  it('severs WhatsApp credentials (empties whatsapp_instance_secrets)', async () => {
    const instanceId = await createInstance(`secret-${Date.now()}`);
    await pg.query(
      `insert into public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token)
       values ($1, $2, $3)`,
      [instanceId, TEST_ORG_ID, 'token-must-be-wiped'],
    );

    const before = await pg.query(
      `select count(*)::int as n from public.whatsapp_instance_secrets`,
    );
    expect(before.rows[0].n).toBeGreaterThan(0);

    await runNeutralize();

    const after = await pg.query(
      `select count(*)::int as n from public.whatsapp_instance_secrets`,
    );
    expect(after.rows[0].n).toBe(0);
  });

  it('pauses app actors (copilot agents, campaigns, workflows)', async () => {
    const agent = await pg.query(
      `insert into public.copilot_agents (created_by, main_objective, name, organization_id, is_active)
       values ($1, 'qualify', 'hml-test-agent', $2, true) returning id`,
      [TEST_MASTER_ID, TEST_ORG_ID],
    );
    const campanha = await pg.query(
      `insert into public.campanhas (name, deadline, organization_id, is_active)
       values ('hml-test-campanha', now() + interval '7 days', $1, true) returning id`,
      [TEST_ORG_ID],
    );
    const workflow = await pg.query(
      `insert into public.workflows (name, organization_id, trigger_type, is_active)
       values ('hml-test-workflow', $1, 'lead_created', true) returning id`,
      [TEST_ORG_ID],
    );

    await runNeutralize();

    const a = await pg.query(
      `select is_active from public.copilot_agents where id = $1`,
      [agent.rows[0].id],
    );
    const c = await pg.query(
      `select is_active from public.campanhas where id = $1`,
      [campanha.rows[0].id],
    );
    const w = await pg.query(
      `select is_active from public.workflows where id = $1`,
      [workflow.rows[0].id],
    );
    expect(a.rows[0].is_active).toBe(false);
    expect(c.rows[0].is_active).toBe(false);
    expect(w.rows[0].is_active).toBe(false);
  });

  it('rewrites prod worker URLs in cron_config (no jsjsm left)', async () => {
    await pg.query(
      `insert into public.cron_config (key, value)
       values ('hml_test_worker_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/x')
       on conflict (key) do update set value = excluded.value`,
    );

    await runNeutralize();

    const leaked = await pg.query(
      `select count(*)::int as n from public.cron_config where value like '%jsjsmuncfkbsbzqzqhfq%'`,
    );
    expect(leaked.rows[0].n).toBe(0);

    const rewritten = await pg.query(
      `select value from public.cron_config where key = 'hml_test_worker_url'`,
    );
    expect(rewritten.rows[0].value).toContain('bcfadphgsibjzivtbjvc');
  });

  it('drains outbound / job queues', async () => {
    const instanceId = await createInstance(`queue-${Date.now()}`);
    await pg.query(
      `insert into public.uazapi_sender_jobs (instance_id, organization_id)
       values ($1, $2)`,
      [instanceId, TEST_ORG_ID],
    );
    await pg.query(
      `insert into public.history_sync_jobs (instance_id, organization_id)
       values ($1, $2)`,
      [instanceId, TEST_ORG_ID],
    );
    const webhook = await pg.query(
      `insert into public.webhooks (name, organization_id, url)
       values ('hml-test-webhook', $1, 'https://example.com/hook') returning id`,
      [TEST_ORG_ID],
    );
    await pg.query(
      `insert into public.webhook_deliveries (event, next_retry_at, payload, webhook_id)
       values ('lead.created', now(), '{}'::jsonb, $1)`,
      [webhook.rows[0].id],
    );

    await runNeutralize();

    for (const table of [
      'uazapi_sender_jobs',
      'history_sync_jobs',
      'webhook_deliveries',
    ]) {
      const res = await pg.query(`select count(*)::int as n from public.${table}`);
      expect(res.rows[0].n).toBe(0);
    }
  });

  it('disables all pg_cron jobs when pg_cron is present (tolerant otherwise)', async () => {
    const hasCron = await pg.query(`select to_regclass('cron.job') as reg`);
    if (!hasCron.rows[0].reg) {
      // pg_cron not installed in this environment — neutralize must no-op safely.
      await runNeutralize();
      return;
    }

    await pg.query(`select cron.schedule('hml-test-job', '* * * * *', 'select 1')`);

    await runNeutralize();

    const active = await pg.query(
      `select count(*)::int as n from cron.job where active`,
    );
    expect(active.rows[0].n).toBe(0);
  });

  it('is idempotent (running twice leaves the same safe state, no error)', async () => {
    await runNeutralize();
    await runNeutralize();

    const secrets = await pg.query(
      `select count(*)::int as n from public.whatsapp_instance_secrets`,
    );
    const leaked = await pg.query(
      `select count(*)::int as n from public.cron_config where value like '%jsjsmuncfkbsbzqzqhfq%'`,
    );
    expect(secrets.rows[0].n).toBe(0);
    expect(leaked.rows[0].n).toBe(0);
  });
});
