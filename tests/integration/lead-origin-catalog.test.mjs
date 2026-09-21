import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';

test('new organizations have searchable origin identities; repair preserves customizations and isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE lead_origins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id), slug text NOT NULL,
        name text NOT NULL, color text NOT NULL, sort_order integer DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true, UNIQUE(organization_id,slug));
      ALTER TABLE lead_origins ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_origins ON lead_origins FOR SELECT TO authenticated
        USING (organization_id = current_setting('test.org')::uuid);
      GRANT SELECT ON lead_origins TO authenticated;
      GRANT INSERT ON organizations TO authenticated;
      INSERT INTO organizations VALUES ('${other}');`);
    await db.exec(read('../../supabase/migrations/20260921165709_seed_organization_lead_origins.sql'));
    await db.exec(`SET test.org='${org}'; SET ROLE authenticated; INSERT INTO organizations VALUES ('${org}');`);
    // Same query shape as useLeadOriginOptions: UUIDs from this org, by name.
    assert.equal((await db.query(`SELECT count(*)::int n FROM lead_origins WHERE organization_id='${org}'`)).rows[0].n,13);
    const whatsapp = (await db.query(`SELECT id FROM lead_origins WHERE organization_id='${org}' AND name ILIKE '%Whats%' ORDER BY name,id LIMIT 25`)).rows[0];
    assert.ok(whatsapp.id);
    assert.equal((await db.query(`SELECT count(*)::int n FROM lead_origins WHERE organization_id='${other}'`)).rows[0].n,0);
    await assert.rejects(db.query(`SELECT public.seed_organization_lead_origins('${other}')`), /permission denied/);
    await db.exec('RESET ROLE');
    await db.exec(`UPDATE lead_origins SET name='Meu WhatsApp',is_active=false WHERE id='${whatsapp.id}';
      SELECT public.seed_organization_lead_origins('${org}');`);
    await db.exec(read('../../scripts/ops/repair-empty-origin-catalogs.sql'));
    await db.exec(read('../../scripts/ops/repair-empty-origin-catalogs.sql'));
    const saved = (await db.query(`SELECT * FROM lead_origins WHERE id='${whatsapp.id}'`)).rows[0];
    assert.equal(saved.name,'Meu WhatsApp'); assert.equal(saved.is_active,false);
    assert.equal((await db.query('SELECT count(*)::int n FROM lead_origins')).rows[0].n,26);
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal((await db.query(`SELECT has_function_privilege('${role}','public.seed_organization_lead_origins(uuid)','EXECUTE') AS allowed`)).rows[0].allowed,false);
    }
    await db.exec(read('../../scripts/ops/rollback-origin-catalog.sql'));
    assert.equal((await db.query('SELECT count(*)::int n FROM lead_origins')).rows[0].n,26);
  } finally { await db.close(); }
});
