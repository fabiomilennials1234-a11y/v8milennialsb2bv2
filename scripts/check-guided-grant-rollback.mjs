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
const query = `BEGIN;
CREATE TEMP TABLE guided_rollback_fixture ON COMMIT DROP AS
  SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS workflow_id,
    pg_get_functiondef('public.set_workflow_data_grant(uuid,text[],integer)'::regprocedure) AS original_definition;
INSERT INTO public.organizations(id, name, slug)
  SELECT org_id, 'Guided rollback rehearsal', 'guided-rollback-' || org_id FROM guided_rollback_fixture;
INSERT INTO public.workflows(id, organization_id, name, trigger_type)
  SELECT workflow_id, org_id, 'Rollback rehearsal', 'manual' FROM guided_rollback_fixture;
INSERT INTO public.workflow_data_grants(workflow_id, organization_id, fields, revision)
  SELECT workflow_id, org_id, ARRAY['lead.name'], 7 FROM guided_rollback_fixture;
INSERT INTO public.workflow_guided_drafts(workflow_id, organization_id, definition, revision)
  SELECT workflow_id, org_id, '{"nodes":[],"edges":[]}'::jsonb, 11 FROM guided_rollback_fixture;
${draftRollback}
${readerRollback}
${conflictRollback}
${rollback}
DO $$ BEGIN
  IF to_regprocedure('public.set_workflow_data_grant(uuid,text[],integer)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_lead(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.save_guided_workflow_draft(uuid,jsonb,integer)') IS NOT NULL
    OR has_table_privilege('authenticated', 'public.workflow_guided_drafts', 'SELECT')
    OR has_table_privilege('service_role', 'public.workflow_guided_drafts', 'SELECT')
    OR has_table_privilege('authenticated', 'public.workflow_data_grants', 'SELECT')
    OR has_table_privilege('service_role', 'public.workflow_data_grants', 'SELECT') THEN
    RAISE EXCEPTION 'rollback left access enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_data_grants g JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE g.revision = 7 AND g.fields = ARRAY['lead.name']) THEN
    RAISE EXCEPTION 'rollback lost approval history';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_guided_drafts d JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE d.revision = 11 AND d.definition = '{"nodes":[],"edges":[]}'::jsonb) THEN
    RAISE EXCEPTION 'rollback lost draft';
  END IF;
END $$;
${forward}
${conflictForward}
${readerForward}
${draftForward}
DO $$ BEGIN
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
    WHERE d.revision = 11 AND d.definition = '{"nodes":[],"edges":[]}'::jsonb) THEN
    RAISE EXCEPTION 'reapply lost draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_data_grants g JOIN guided_rollback_fixture f USING(workflow_id)
    WHERE g.revision = 7 AND g.fields = ARRAY['lead.name']) THEN
    RAISE EXCEPTION 'reapply lost approval history';
  END IF;
  IF pg_get_functiondef('public.set_workflow_data_grant(uuid,text[],integer)'::regprocedure)
    <> (SELECT original_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'reapply did not restore the original function';
  END IF;
END $$;
ROLLBACK;
SELECT 'rollback and reapply preserved synthetic approval history' AS result;`;
execFileSync(process.execPath, ['scripts/branch-sql.mjs', '--ref', ref, query], { stdio: 'inherit' });
