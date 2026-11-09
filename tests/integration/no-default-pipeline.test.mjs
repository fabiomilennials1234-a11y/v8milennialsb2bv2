import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('retire designation preserves funnels/cards, protects old clients and new organizations', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE TYPE stage_role AS ENUM ('open','meeting_booked','won','lost');
      CREATE TABLE organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), default_pipeline_id uuid,
        confirmacao_overdue_days int DEFAULT 5, default_reorder_cycle_days int DEFAULT 30, ui_v5_enabled boolean DEFAULT false);
      CREATE TABLE pipelines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations,
        name text, slug text, type text, description text, icon text, color text, display_order int, is_active boolean, config jsonb,
        UNIQUE(organization_id,slug));
      CREATE TABLE pipeline_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, pipeline_id uuid REFERENCES pipelines,
        pipeline_type text, stage_key text, name text, color text, position int, is_active boolean, stage_role stage_role,
        is_final_positive boolean, is_final_negative boolean, requires_sale_value boolean, UNIQUE(pipeline_id,stage_key));
      CREATE TABLE pipeline_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pipeline_id uuid REFERENCES pipelines, lead_id uuid);
      CREATE TABLE team_members(user_id uuid, organization_id uuid, role text, is_active boolean);
      CREATE TABLE permission_audit_log(organization_id uuid, changed_by_user_id uuid, changed_by_role text,
        table_name text, permission_key text, role text, old_enabled boolean, new_enabled boolean);
      INSERT INTO organizations(id) VALUES ('00000000-0000-4000-8000-000000000001');
      INSERT INTO pipelines(id, organization_id,name,slug) VALUES
        ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Existing','existing');
      UPDATE organizations SET default_pipeline_id='00000000-0000-4000-8000-000000000002';
      INSERT INTO pipeline_entries(pipeline_id,lead_id) VALUES
        ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
      CREATE FUNCTION public.fn_guard_default_pipeline_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'old default guard'; END; $$;
      CREATE TRIGGER trg_guard_default_pipeline_delete BEFORE DELETE ON pipelines
        FOR EACH ROW EXECUTE FUNCTION fn_guard_default_pipeline_delete();
    `);
    const before = (await db.query('select * from pipeline_entries')).rows;
    const migration = readFileSync(new URL('../../supabase/migrations/20271228000001_retire_org_default_pipeline.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from pipeline_entries')).rows, before);
    assert.equal((await db.query('select name from pipelines')).rows[0].name, 'Existing');
    assert.equal((await db.query('select default_pipeline_id from organizations')).rows[0].default_pipeline_id, null);
    // An old browser/backend cannot reintroduce the designation, even with a valid ID.
    await db.exec("UPDATE organizations SET default_pipeline_id='00000000-0000-4000-8000-000000000002'");
    assert.equal((await db.query('select default_pipeline_id from organizations')).rows[0].default_pipeline_id, null);
    await assert.rejects(db.query("select set_org_settings(id, '{\"default_pipeline_id\":null}') from organizations"), /não permitido/);
    // Other operational settings still work and are audited.
    await db.exec("select set_org_settings(id, '{\"confirmacao_overdue_days\":8}') from organizations");
    assert.equal((await db.query('select confirmacao_overdue_days from organizations')).rows[0].confirmacao_overdue_days, 8);
    assert.equal((await db.query('select count(*)::int as n from permission_audit_log')).rows[0].n, 1);
    await db.exec('CREATE OR REPLACE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;');
    await assert.rejects(db.query("select set_org_settings(id, '{\"confirmacao_overdue_days\":9}') from organizations"), /forbidden/);
    assert.equal((await db.query('select confirmacao_overdue_days from organizations')).rows[0].confirmacao_overdue_days, 8);
    // The factory recipe remains available; its funnel is ordinary and idempotent.
    await db.exec("INSERT INTO organizations(id) VALUES ('00000000-0000-4000-8000-000000000004'); SELECT seed_default_sales_funnel('00000000-0000-4000-8000-000000000004'); SELECT seed_default_sales_funnel('00000000-0000-4000-8000-000000000004');");
    assert.equal((await db.query("select count(*)::int as n from pipelines where organization_id='00000000-0000-4000-8000-000000000004'")).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from pipeline_stages')).rows[0].n, 6);
    assert.equal((await db.query('select count(*)::int as n from organizations where default_pipeline_id is not null')).rows[0].n, 0);
    // Existing safe deletion rules remain; only the default-specific guard is gone.
    await db.exec('DELETE FROM pipeline_entries; DELETE FROM pipelines WHERE slug=\'existing\';');
  } finally { await db.close(); }
});
