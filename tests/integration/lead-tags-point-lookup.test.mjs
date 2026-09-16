import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20260916124457_lead_tags_insert_point_lookup.sql', import.meta.url), 'utf8');

test('tag insertion checks the chosen lead, preserving member visibility and tenant boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT current_setting('test.uid')::uuid $$;
      CREATE TABLE team_members(user_id uuid, organization_id uuid);
      CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, owner_id uuid, deleted_at timestamptz);
      CREATE TABLE lead_tags(id uuid DEFAULT gen_random_uuid(), lead_id uuid REFERENCES leads, tag_id uuid);
      CREATE SEQUENCE access_checks;
      CREATE FUNCTION visible_lead(owner_id uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
      BEGIN PERFORM nextval('access_checks'); RETURN owner_id=auth.uid(); END $$;
      ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;
      CREATE POLICY leads_select ON leads FOR SELECT USING (deleted_at IS NULL AND visible_lead(owner_id));
      CREATE POLICY lead_tags_select ON lead_tags FOR SELECT USING (true);
      CREATE POLICY lead_tags_insert_organization ON lead_tags FOR INSERT WITH CHECK (
        lead_id IN (SELECT leads.id FROM leads WHERE organization_id IN (
          SELECT organization_id FROM team_members WHERE user_id=(SELECT auth.uid())
        ))
      );
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT SELECT ON leads,team_members,lead_tags TO authenticated;
      GRANT INSERT ON lead_tags TO authenticated;
      GRANT USAGE,SELECT,UPDATE ON SEQUENCE access_checks TO authenticated;
      SET test.uid='00000000-0000-0000-0000-000000000001';
      INSERT INTO team_members VALUES (auth.uid(),'00000000-0000-0000-0000-000000000002');
      INSERT INTO leads SELECT md5(i::text)::uuid,'00000000-0000-0000-0000-000000000002',auth.uid(),NULL FROM generate_series(1,1500) i;
      INSERT INTO leads VALUES
        ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002',auth.uid(),NULL),
        ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000003',auth.uid(),NULL),
        ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000099',NULL),
        ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002',auth.uid(),now());
      ANALYZE leads;
    `);
    if (migration.trim()) await db.exec(migration);
    await db.exec('SET ROLE authenticated');
    const insert = id => db.query('INSERT INTO lead_tags(lead_id,tag_id) VALUES ($1,gen_random_uuid()) RETURNING id', [id]);
    await db.exec("SELECT setval('access_checks',1,false)");
    assert.equal((await insert('00000000-0000-0000-0000-000000000010')).rows.length, 1);
    const checks = Number((await db.query('SELECT last_value FROM access_checks')).rows[0].last_value);
    assert.ok(checks <= 2, `Expected a point lookup; evaluated ${checks} leads`);
    for (const suffix of ['011','012','013','014']) {
      await assert.rejects(insert(`00000000-0000-0000-0000-000000000${suffix}`), /row-level security/);
    }
    await db.exec("SET test.uid='00000000-0000-0000-0000-000000000099'");
    await assert.rejects(insert('00000000-0000-0000-0000-000000000012'), /row-level security/);
  } finally { await db.close(); }
});
