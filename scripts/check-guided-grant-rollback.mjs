/** Rehearse the actual rollback and reapply SQL in one preview transaction.
 * A synthetic grant must survive both transitions. ROLLBACK removes all fixture
 * data and returns schema/privileges to the state before this rehearsal.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ref = process.argv[2];
if (!ref || ['jsjsmuncfkbsbzqzqhfq', 'bcfadphgsibjzivtbjvc'].includes(ref)) throw new Error('Preview required');
const branches = JSON.parse(execFileSync('supabase', ['branches', 'list', '--project-ref', 'jsjsmuncfkbsbzqzqhfq', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
if (!branches.some(branch => !branch.is_default && branch.project_ref === ref && branch.preview_project_status === 'ACTIVE_HEALTHY')) throw new Error('Healthy non-default preview required');
const migration = '20271017000000_workflow_data_grants.sql';
const forward = readFileSync(`supabase/migrations/${migration}`, 'utf8');
const rollback = readFileSync(`supabase/migrations/rollback/${migration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const conflictMigration = '20271017000001_workflow_grant_revision_conflict.sql';
const conflictForward = readFileSync(`supabase/migrations/${conflictMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const conflictRollback = readFileSync(`supabase/migrations/rollback/${conflictMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const readerMigration = '20271017000002_guided_condition_authorized_read.sql';
const readerForward = readFileSync(`supabase/migrations/${readerMigration}`, 'utf8');
const readerRollback = readFileSync(`supabase/migrations/rollback/${readerMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const draftMigration = '20271017000003_guided_workflow_drafts.sql';
const draftForward = readFileSync(`supabase/migrations/${draftMigration}`, 'utf8');
const draftRollback = readFileSync(`supabase/migrations/rollback/${draftMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const masterMigration = '20271017000004_guided_workflow_master_authorization.sql';
const masterForward = readFileSync(`supabase/migrations/${masterMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const masterRollback = readFileSync(`supabase/migrations/rollback/${masterMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const createMigration = '20271017000005_create_guided_workflow_draft.sql';
const createForward = readFileSync(`supabase/migrations/${createMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const createRollback = readFileSync(`supabase/migrations/rollback/${createMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const settingsMigration = '20271017000006_guided_workflow_draft_settings.sql';
const settingsForward = readFileSync(`supabase/migrations/${settingsMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const settingsRollback = readFileSync(`supabase/migrations/rollback/${settingsMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const initialSettingsMigration = '20271017000007_create_guided_workflow_draft_settings.sql';
const initialSettingsForward = readFileSync(`supabase/migrations/${initialSettingsMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const initialSettingsRollback = readFileSync(`supabase/migrations/rollback/${initialSettingsMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const publicationMigration = '20271017000008_guided_workflow_publication.sql';
const publicationForward = readFileSync(`supabase/migrations/${publicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const publicationRollback = readFileSync(`supabase/migrations/rollback/${publicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const pinMigration = '20271017000009_guided_execution_version.sql';
const pinForward = readFileSync(`supabase/migrations/${pinMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const pinRollback = readFileSync(`supabase/migrations/rollback/${pinMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const discoveryMigration = '20271017000010_guided_publication_discovery.sql';
const discoveryForward = readFileSync(`supabase/migrations/${discoveryMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const discoveryRollback = readFileSync(`supabase/migrations/rollback/${discoveryMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const activationMigration = '20271017000011_guided_activation.sql';
const activationForward = readFileSync(`supabase/migrations/${activationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const activationRollback = readFileSync(`supabase/migrations/rollback/${activationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const companyMigration = '20271017000012_guided_company_authorization.sql';
const companyRollback = readFileSync(`supabase/migrations/rollback/${companyMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const contactMigration = '20271017000013_guided_contact_authorization.sql';
const contactRollback = readFileSync(`supabase/migrations/rollback/${contactMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const tagMigration = '20271017000014_guided_personal_tag_test.sql';
const tagForward = readFileSync(`supabase/migrations/${tagMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const tagRollback = readFileSync(`supabase/migrations/rollback/${tagMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const tagAuthorizationMigration = '20271017000015_guided_tag_authorization.sql';
const tagAuthorizationRollback = readFileSync(`supabase/migrations/rollback/${tagAuthorizationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const tagPublicationMigration = '20271017000016_guided_tag_publication.sql';
const tagPublicationRollback = readFileSync(`supabase/migrations/rollback/${tagPublicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const referenceLocationMigration = '20271017000017_guided_reference_locations.sql';
const referenceLocationRollback = readFileSync(`supabase/migrations/rollback/${referenceLocationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const scoreMigration = '20271017000018_guided_score_authorization.sql';
const scoreRollback = readFileSync(`supabase/migrations/rollback/${scoreMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const campaignMigration = '20271017000019_guided_utm_campaign_authorization.sql';
const campaignRollback = readFileSync(`supabase/migrations/rollback/${campaignMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const utmMigration = '20271017000020_guided_utm_authorization.sql';
const utmRollback = readFileSync(`supabase/migrations/rollback/${utmMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const originMigration = '20271017000021_guided_personal_origin_test.sql';
const originForward = readFileSync(`supabase/migrations/${originMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const originRollback = readFileSync(`supabase/migrations/rollback/${originMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const originAuthorizationMigration = '20271017000022_guided_origin_authorization.sql';
const originAuthorizationRollback = readFileSync(`supabase/migrations/rollback/${originAuthorizationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const responsibleMigration = '20271017000023_guided_personal_responsible_test.sql';
const responsibleForward = readFileSync(`supabase/migrations/${responsibleMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const responsibleRollback = readFileSync(`supabase/migrations/rollback/${responsibleMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const catalogueMigration = '20271017000024_guided_responsible_catalogue.sql';
const catalogueForward = readFileSync(`supabase/migrations/${catalogueMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const catalogueRollback = readFileSync(`supabase/migrations/rollback/${catalogueMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const responsibleReadMigration = '20271017000025_guided_responsible_authorized_read.sql';
const responsibleReadRollback = readFileSync(`supabase/migrations/rollback/${responsibleReadMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const responsiblePublicationMigration = '20271017000026_guided_responsible_publication.sql';
const responsiblePublicationForward = readFileSync(`supabase/migrations/${responsiblePublicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const responsiblePublicationRollback = readFileSync(`supabase/migrations/rollback/${responsiblePublicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const query = `BEGIN;
CREATE TEMP TABLE guided_rollback_fixture ON COMMIT DROP AS
  SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS workflow_id,
    pg_get_functiondef('public.set_workflow_data_grant(uuid,text[],integer)'::regprocedure) AS original_definition,
    pg_get_functiondef('public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])'::regprocedure) AS original_publication_definition;
INSERT INTO public.organizations(id, name, slug)
  SELECT org_id, 'Guided rollback rehearsal', 'guided-rollback-' || org_id FROM guided_rollback_fixture;
INSERT INTO public.workflows(id, organization_id, name, trigger_type)
  SELECT workflow_id, org_id, 'Rollback rehearsal', 'manual' FROM guided_rollback_fixture;
INSERT INTO public.workflow_data_grants(workflow_id, organization_id, fields, revision)
  SELECT workflow_id, org_id, ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'], 7 FROM guided_rollback_fixture;
INSERT INTO public.workflow_guided_drafts(workflow_id, organization_id, definition, revision)
  SELECT workflow_id, org_id, '{"nodes":[],"edges":[]}'::jsonb, 11 FROM guided_rollback_fixture;
UPDATE public.workflow_guided_drafts SET settings = '{"name":"Preserved settings"}'::jsonb
  WHERE workflow_id = (SELECT workflow_id FROM guided_rollback_fixture);
INSERT INTO public.workflow_guided_versions(workflow_id, organization_id, version_number, source_revision, definition, settings, required_fields)
  SELECT workflow_id, org_id, 1, 11, '{"nodes":[{"id":"t","type":"trigger","data":{"triggerType":"lead_created","config":{}}}],"edges":[]}'::jsonb, '{"name":"Preserved publication"}'::jsonb, ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] FROM guided_rollback_fixture;
INSERT INTO public.workflow_guided_publications(workflow_id, organization_id, version_id)
  SELECT v.workflow_id, v.organization_id, v.id FROM public.workflow_guided_versions v JOIN guided_rollback_fixture f USING(workflow_id);
INSERT INTO public.workflow_executions(workflow_id, organization_id, status, next_run_at)
  SELECT workflow_id, org_id, 'waiting', '2099-01-01'::timestamptz FROM guided_rollback_fixture;
${responsiblePublicationRollback}
${responsibleReadRollback}
DO $$ BEGIN
  IF to_regprocedure('public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'responsible authorized reader remains after rollback';
  END IF;
END $$;
${catalogueRollback}
DO $$ BEGIN
  IF to_regclass('public.guided_responsible_members') IS NOT NULL THEN
    RAISE EXCEPTION 'guided responsible catalogue remains after rollback';
  END IF;
END $$;
${responsibleRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'personal responsible test still callable after rollback';
  END IF;
END $$;
${originAuthorizationRollback}
DO $$ BEGIN
  IF to_regprocedure('public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'origin authorized reader still callable after rollback';
  END IF;
END $$;
${originRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_origins(uuid,uuid,uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'personal origin test still callable after rollback';
  END IF;
END $$;
${utmRollback}
${campaignRollback}
${scoreRollback}
${referenceLocationRollback}
${tagPublicationRollback}
${tagAuthorizationRollback}
DO $$ BEGIN
  IF to_regprocedure('public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'authorized tag reader still callable after rollback';
  END IF;
END $$;
${tagRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_tags(uuid,uuid,uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'personal tag test still callable after rollback';
  END IF;
END $$;
${contactRollback}
${companyRollback}
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'rolled back company reader remains callable';
  END IF;
END $$;
${activationRollback}
${discoveryRollback}
${pinRollback}
${publicationRollback}
${initialSettingsRollback}
${settingsRollback}
${createRollback}
${masterRollback}
${draftRollback}
${readerRollback}
${conflictRollback}
${rollback}
DO $$ BEGIN
  IF to_regprocedure('public.set_guided_workflow_active(uuid,boolean,uuid)') IS NOT NULL
    OR to_regprocedure('public.sync_guided_publication_discovery()') IS NOT NULL
    OR to_regprocedure('public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])') IS NOT NULL
    OR has_table_privilege('authenticated', 'public.workflow_guided_versions', 'SELECT')
    OR has_table_privilege('service_role', 'public.workflow_guided_versions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.workflow_guided_publications', 'SELECT')
    OR has_table_privilege('service_role', 'public.workflow_guided_publications', 'SELECT')
    OR to_regprocedure('public.set_workflow_data_grant(uuid,text[],integer)') IS NOT NULL
    OR to_regprocedure('public.can_administer_guided_workflow(uuid)') IS NOT NULL
    OR to_regprocedure('public.create_guided_workflow_draft(uuid,uuid,text,jsonb)') IS NOT NULL
    OR to_regprocedure('public.save_guided_workflow_draft_with_settings(uuid,jsonb,integer,jsonb)') IS NOT NULL
    OR to_regprocedure('public.create_guided_workflow_draft_with_settings(uuid,uuid,jsonb,jsonb)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_lead(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.save_guided_workflow_draft(uuid,jsonb,integer)') IS NOT NULL
    OR has_table_privilege('authenticated', 'public.workflow_guided_drafts', 'SELECT')
    OR has_table_privilege('service_role', 'public.workflow_guided_drafts', 'SELECT')
    OR has_table_privilege('authenticated', 'public.workflow_data_grants', 'SELECT')
    OR has_table_privilege('service_role', 'public.workflow_data_grants', 'SELECT') THEN
    RAISE EXCEPTION 'rollback left access enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_data_grants g JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE g.revision = 7 AND g.fields = ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']) THEN
    RAISE EXCEPTION 'rollback lost approval history';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_guided_drafts d JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE d.revision = 11 AND d.definition = '{"nodes":[],"edges":[]}'::jsonb
      AND d.settings = '{"name":"Preserved settings"}'::jsonb) THEN
    RAISE EXCEPTION 'rollback lost draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_guided_publications p
    JOIN public.workflow_guided_versions v ON v.id = p.version_id
    JOIN guided_rollback_fixture f ON f.workflow_id = p.workflow_id
    WHERE v.source_revision = 11 AND v.version_number = 1
      AND v.definition = '{"nodes":[{"id":"t","type":"trigger","data":{"triggerType":"lead_created","config":{}}}],"edges":[]}'::jsonb
      AND v.settings = '{"name":"Preserved publication"}'::jsonb
      AND v.required_fields = ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']) THEN
    RAISE EXCEPTION 'publication history or selection lost';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_executions e JOIN guided_rollback_fixture f USING(workflow_id)
    JOIN public.workflow_guided_publications p ON p.workflow_id = e.workflow_id
    WHERE e.guided_version_id = p.version_id) THEN
    RAISE EXCEPTION 'execution version lost';
  END IF;
  IF has_function_privilege('anon', 'public.pin_guided_execution_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.pin_guided_execution_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.pin_guided_execution_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'pin trigger function callable directly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflows w JOIN guided_rollback_fixture f ON f.workflow_id = w.id
    WHERE w.name = 'Preserved publication' AND w.trigger_type = 'lead_created' AND w.trigger_config = '{}'::jsonb) THEN
    RAISE EXCEPTION 'published discovery metadata lost';
  END IF;
  IF has_function_privilege('anon', 'public.guard_guided_workflow_activation()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.guard_guided_workflow_activation()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.guard_guided_workflow_activation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'activation guard callable directly';
  END IF;
END $$;
DO $$ DECLARE denied boolean := false; BEGIN
  BEGIN
    UPDATE public.workflows SET is_active = true WHERE id = (SELECT workflow_id FROM guided_rollback_fixture);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'rollback allowed guided activation'; END IF;
END $$;
${forward}
${conflictForward}
${readerForward}
${draftForward}
${masterForward}
${createForward}
${settingsForward}
${initialSettingsForward}
${publicationForward}
${pinForward}
${discoveryForward}
${activationForward}
-- Migration 22 restores the complete field contract without narrowing retained grants.
${responsiblePublicationForward}
${tagForward}
${originForward}
${responsibleForward}
${catalogueForward}
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'responsible authorized reader privileges invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_table_privilege('anon', 'public.guided_responsible_members', 'SELECT')
    OR has_table_privilege('service_role', 'public.guided_responsible_members', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.guided_responsible_members', 'SELECT')
    OR has_table_privilege('authenticated', 'public.guided_responsible_members', 'INSERT,UPDATE,DELETE')
    OR NOT (SELECT reloptions @> ARRAY['security_invoker=true','security_barrier=true']
      FROM pg_class WHERE oid = 'public.guided_responsible_members'::regclass) THEN
    RAISE EXCEPTION 'guided responsible catalogue privileges invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'personal responsible test grants invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'origin authorized reader grants invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_origins(uuid,uuid,uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_origins(uuid,uuid,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_origins(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'personal origin test grants invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'authorized tag reader grants invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_tags(uuid,uuid,uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_tags(uuid,uuid,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_tags(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'personal tag test grants invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'company reader grants invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.set_guided_workflow_active(uuid,boolean,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.set_guided_workflow_active(uuid,boolean,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.set_guided_workflow_active(uuid,boolean,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'activation privileges incorrect';
  END IF;
  IF has_function_privilege('anon', 'public.sync_guided_publication_discovery()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.sync_guided_publication_discovery()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.sync_guided_publication_discovery()', 'EXECUTE') THEN
    RAISE EXCEPTION 'discovery function callable directly';
  END IF;
  IF has_function_privilege('anon', 'public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])', 'EXECUTE')
    OR has_table_privilege('authenticated', 'public.workflow_guided_versions', 'INSERT,UPDATE,DELETE')
    OR has_table_privilege('service_role', 'public.workflow_guided_versions', 'INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', 'public.workflow_guided_publications', 'INSERT,UPDATE,DELETE')
    OR has_table_privilege('service_role', 'public.workflow_guided_publications', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'publication privileges incorrect';
  END IF;
  IF has_function_privilege('anon', 'public.save_guided_workflow_draft_with_settings(uuid,jsonb,integer,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.save_guided_workflow_draft_with_settings(uuid,jsonb,integer,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.save_guided_workflow_draft_with_settings(uuid,jsonb,integer,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_guided_workflow_draft_with_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.create_guided_workflow_draft_with_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_guided_workflow_draft_with_settings(uuid,uuid,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reapply did not restore settings privileges';
  END IF;
  IF has_function_privilege('anon', 'public.create_guided_workflow_draft(uuid,uuid,text,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.create_guided_workflow_draft(uuid,uuid,text,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_guided_workflow_draft(uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reapply did not restore creation privileges';
  END IF;
  IF has_function_privilege('anon', 'public.can_administer_guided_workflow(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.can_administer_guided_workflow(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.can_administer_guided_workflow(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reapply did not restore master helper privileges';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_workflow_data_grant(uuid,text[],integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.set_workflow_data_grant(uuid,text[],integer)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.set_workflow_data_grant(uuid,text[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reapply did not restore intended privileges';
  END IF;
  IF has_function_privilege('authenticated', 'public.read_guided_condition_lead(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_lead(uuid,uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_lead(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reapply did not restore reader privileges';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.save_guided_workflow_draft(uuid,jsonb,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.save_guided_workflow_draft(uuid,jsonb,integer)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.save_guided_workflow_draft(uuid,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reapply did not restore draft privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_guided_drafts d JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE d.revision = 11 AND d.definition = '{"nodes":[],"edges":[]}'::jsonb
      AND d.settings = '{"name":"Preserved settings"}'::jsonb) THEN
    RAISE EXCEPTION 'reapply lost draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_data_grants g JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE g.revision = 7 AND g.fields = ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']) THEN
    RAISE EXCEPTION 'reapply lost approval history';
  END IF;
  IF pg_get_functiondef('public.set_workflow_data_grant(uuid,text[],integer)'::regprocedure)
    <> (SELECT original_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'reapply did not restore the original function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_guided_publications p
    JOIN public.workflow_guided_versions v ON v.id = p.version_id
    JOIN guided_rollback_fixture f ON f.workflow_id = p.workflow_id
    WHERE v.source_revision = 11 AND v.version_number = 1
      AND v.definition = '{"nodes":[{"id":"t","type":"trigger","data":{"triggerType":"lead_created","config":{}}}],"edges":[]}'::jsonb
      AND v.settings = '{"name":"Preserved publication"}'::jsonb
      AND v.required_fields = ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']) THEN
    RAISE EXCEPTION 'publication history or selection lost';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_executions e JOIN guided_rollback_fixture f USING(workflow_id)
    JOIN public.workflow_guided_publications p ON p.workflow_id = e.workflow_id
    WHERE e.guided_version_id = p.version_id) THEN
    RAISE EXCEPTION 'execution version lost';
  END IF;
  IF has_function_privilege('anon', 'public.pin_guided_execution_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.pin_guided_execution_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.pin_guided_execution_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'pin trigger function callable directly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflows w JOIN guided_rollback_fixture f ON f.workflow_id = w.id
    WHERE w.name = 'Preserved publication' AND w.trigger_type = 'lead_created' AND w.trigger_config = '{}'::jsonb) THEN
    RAISE EXCEPTION 'published discovery metadata lost';
  END IF;
  IF has_function_privilege('anon', 'public.guard_guided_workflow_activation()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.guard_guided_workflow_activation()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.guard_guided_workflow_activation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'activation guard callable directly';
  END IF;
END $$;
DO $$ BEGIN
  IF pg_get_functiondef('public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])'::regprocedure)
    IS DISTINCT FROM (SELECT original_publication_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'publication definition not restored';
  END IF;
END $$;
ROLLBACK;
SELECT 'rollback and reapply preserved synthetic approval history' AS result;`;
execFileSync(process.execPath, ['scripts/branch-sql.mjs', '--ref', ref, query], { stdio: 'inherit' });
