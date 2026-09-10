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
const responsiblePublicationRollback = readFileSync(`supabase/migrations/rollback/${responsiblePublicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const presenceMigration = '20271017000027_guided_reference_presence.sql';
const presenceRollback = readFileSync(`supabase/migrations/rollback/${presenceMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const profileMigration = '20271017000028_guided_business_profile_fields.sql';
const profileRollback = readFileSync(`supabase/migrations/rollback/${profileMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const customMigration = '20271017000029_guided_personal_custom_field_test.sql';
const customForward = readFileSync(`supabase/migrations/${customMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const customRollback = readFileSync(`supabase/migrations/rollback/${customMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const customOrgMigration = '20271017000030_guided_custom_field_authorization.sql';
const customOrgForward = readFileSync(`supabase/migrations/${customOrgMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const customOrgRollback = readFileSync(`supabase/migrations/rollback/${customOrgMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const customPublicationMigration = '20271017000031_guided_custom_field_publication.sql';
const customPublicationForward = readFileSync(`supabase/migrations/${customPublicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const customPublicationRollback = readFileSync(`supabase/migrations/rollback/${customPublicationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const numericMigration = '20271017000032_guided_custom_numeric_publication.sql';
const numericForward = readFileSync(`supabase/migrations/${numericMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const numericRollback = readFileSync(`supabase/migrations/rollback/${numericMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const booleanMigration = '20271017000033_guided_custom_boolean_publication.sql';
const booleanForward = readFileSync(`supabase/migrations/${booleanMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const booleanRollback = readFileSync(`supabase/migrations/rollback/${booleanMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const dateMigration = '20271017000034_guided_custom_date_publication.sql';
const dateForward = readFileSync(`supabase/migrations/${dateMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const dateRollback = readFileSync(`supabase/migrations/rollback/${dateMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const optionsMigration = '20271017000035_guided_personal_custom_options.sql';
const optionsForward = readFileSync(`supabase/migrations/${optionsMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const optionsRollback = readFileSync(`supabase/migrations/rollback/${optionsMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const selectMigration = '20271017000036_guided_custom_select_publication.sql';
const selectForward = readFileSync(`supabase/migrations/${selectMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const selectRollback = readFileSync(`supabase/migrations/rollback/${selectMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const limitMigration = '20271017000037_guided_custom_read_limits.sql';
const limitForward = readFileSync(`supabase/migrations/${limitMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const limitRollback = readFileSync(`supabase/migrations/rollback/${limitMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const stageClockMigration = '20271017000038_restart_stage_time_on_funnel_change.sql';
const stageClockForward = readFileSync(`supabase/migrations/${stageClockMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const stageClockRollback = readFileSync(`supabase/migrations/rollback/${stageClockMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessPersonalMigration = '20271017000039_guided_personal_trigger_business_stage.sql';
const businessPersonalForward = readFileSync(`supabase/migrations/${businessPersonalMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessPersonalRollback = readFileSync(`supabase/migrations/rollback/${businessPersonalMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessAuthorizationMigration = '20271017000040_guided_trigger_business_stage_authorization.sql';
const businessAuthorizationForward = readFileSync(`supabase/migrations/${businessAuthorizationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessAuthorizationRollback = readFileSync(`supabase/migrations/rollback/${businessAuthorizationMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessVolatilityMigration = '20271017000041_fix_trigger_business_reader_volatility.sql';
const businessVolatilityForward = readFileSync(`supabase/migrations/${businessVolatilityMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessVolatilityRollback = readFileSync(`supabase/migrations/rollback/${businessVolatilityMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessValueMigration = '20271017000042_guided_trigger_business_value.sql';
const businessValueForward = readFileSync(`supabase/migrations/${businessValueMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessValueRollback = readFileSync(`supabase/migrations/rollback/${businessValueMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessElapsedMigration = '20271017000043_guided_trigger_business_stage_elapsed.sql';
const businessElapsedForward = readFileSync(`supabase/migrations/${businessElapsedMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessElapsedRollback = readFileSync(`supabase/migrations/rollback/${businessElapsedMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessExistenceMigration = '20271017000044_guided_business_existence.sql';
const businessExistenceForward = readFileSync(`supabase/migrations/${businessExistenceMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const businessExistenceRollback = readFileSync(`supabase/migrations/rollback/${businessExistenceMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const lastWonMigration = '20271017000045_guided_last_won_date.sql';
const lastWonForward = readFileSync(`supabase/migrations/${lastWonMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const lastWonRollback = readFileSync(`supabase/migrations/rollback/${lastWonMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const triggerMessageMigration = '20271017000046_guided_trigger_message_text.sql';
const triggerMessageForward = readFileSync(`supabase/migrations/${triggerMessageMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const triggerMessageRollback = readFileSync(`supabase/migrations/rollback/${triggerMessageMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageCandidatesMigration = '20271017000047_guided_message_test_candidates.sql';
const messageCandidatesForward = readFileSync(`supabase/migrations/${messageCandidatesMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageCandidatesRollback = readFileSync(`supabase/migrations/rollback/${messageCandidatesMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageCoverageMigration = '20271017000048_guided_message_history_coverage.sql';
const messageCoverageForward = readFileSync(`supabase/migrations/${messageCoverageMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageCoverageRollback = readFileSync(`supabase/migrations/rollback/${messageCoverageMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageSearchMigration = '20271017000049_guided_message_text_search.sql';
const messageSearchForward = readFileSync(`supabase/migrations/${messageSearchMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageSearchRollback = readFileSync(`supabase/migrations/rollback/${messageSearchMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageWaitingMigration = '20271017000050_guided_message_waiting_elapsed.sql';
const messageWaitingForward = readFileSync(`supabase/migrations/${messageWaitingMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const messageWaitingRollback = readFileSync(`supabase/migrations/rollback/${messageWaitingMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const conditionRetryMigration = '20271017000051_guided_condition_retry_state.sql';
const conditionRetryForward = readFileSync(`supabase/migrations/${conditionRetryMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const conditionRetryRollback = readFileSync(`supabase/migrations/rollback/${conditionRetryMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const historySecurityMigration = '20271017000052_secure_guided_execution_history.sql';
const historySecurityForward = readFileSync(`supabase/migrations/${historySecurityMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const historySecurityRollback = readFileSync(`supabase/migrations/rollback/${historySecurityMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const followUpMigration = '20271017000053_guided_follow_up_condition.sql';
const followUpForward = readFileSync(`supabase/migrations/${followUpMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const followUpRollback = readFileSync(`supabase/migrations/rollback/${followUpMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const productMigration = '20271017000054_guided_product_relation.sql';
const productForward = readFileSync(`supabase/migrations/${productMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const productRollback = readFileSync(`supabase/migrations/rollback/${productMigration}`, 'utf8').replace(/^(BEGIN|COMMIT);\s*$/gm, '');
const query = `BEGIN;
CREATE TEMP TABLE guided_rollback_fixture ON COMMIT DROP AS
  SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS workflow_id, gen_random_uuid() AS custom_field_id, gen_random_uuid() AS custom_lead_id,
    pg_get_functiondef('public.read_guided_condition_custom_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])'::regprocedure) AS original_custom_org_definition,
    pg_get_functiondef('public.test_guided_condition_custom_fields(uuid,uuid,uuid[])'::regprocedure) AS original_custom_definition,
    pg_get_functiondef('public.test_guided_condition_custom_options(uuid,uuid,uuid[])'::regprocedure) AS original_options_definition,
    pg_get_functiondef('public.set_pipeline_entry_stage_changed()'::regprocedure) AS original_stage_clock_definition,
    pg_get_functiondef('public.set_workflow_data_grant(uuid,text[],integer)'::regprocedure) AS original_definition,
    pg_get_functiondef('public.finalize_guided_workflow_publication(uuid,uuid,uuid,integer,jsonb,jsonb,text[])'::regprocedure) AS original_publication_definition;
INSERT INTO public.organizations(id, name, slug)
  SELECT org_id, 'Guided rollback rehearsal', 'guided-rollback-' || org_id FROM guided_rollback_fixture;
INSERT INTO public.leads(id, organization_id, name)
  SELECT custom_lead_id, org_id, 'Custom rollback lead' FROM guided_rollback_fixture;
INSERT INTO public.lead_custom_fields(id, organization_id, field_name, field_type, field_options)
  SELECT custom_field_id, org_id, 'Custom rollback field', 'select', '["Preserved custom answer","Another option"]'::jsonb FROM guided_rollback_fixture;
INSERT INTO public.lead_custom_field_values(lead_id, field_id, value)
  SELECT custom_lead_id, custom_field_id, 'Preserved custom answer' FROM guided_rollback_fixture;
INSERT INTO public.workflows(id, organization_id, name, trigger_type)
  SELECT workflow_id, org_id, 'Rollback rehearsal', 'manual' FROM guided_rollback_fixture;
INSERT INTO public.workflow_data_grants(workflow_id, organization_id, fields, revision)
  SELECT workflow_id, org_id, (ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] || ARRAY['lead.custom:' || custom_field_id::text]), 7 FROM guided_rollback_fixture;
INSERT INTO public.workflow_guided_drafts(workflow_id, organization_id, definition, revision)
  SELECT workflow_id, org_id, '{"nodes":[],"edges":[]}'::jsonb, 11 FROM guided_rollback_fixture;
UPDATE public.workflow_guided_drafts SET settings = '{"name":"Preserved settings"}'::jsonb
  WHERE workflow_id = (SELECT workflow_id FROM guided_rollback_fixture);
INSERT INTO public.workflow_guided_versions(workflow_id, organization_id, version_number, source_revision, definition, settings, required_fields)
  SELECT workflow_id, org_id, 1, 11, '{"nodes":[{"id":"t","type":"trigger","data":{"triggerType":"lead_created","config":{}}}],"edges":[]}'::jsonb, '{"name":"Preserved publication"}'::jsonb, (ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] || ARRAY['lead.custom:' || custom_field_id::text]) FROM guided_rollback_fixture;
INSERT INTO public.workflow_guided_publications(workflow_id, organization_id, version_id)
  SELECT v.workflow_id, v.organization_id, v.id FROM public.workflow_guided_versions v JOIN guided_rollback_fixture f USING(workflow_id);
INSERT INTO public.workflow_executions(workflow_id, organization_id, status, next_run_at)
  SELECT workflow_id, org_id, 'waiting', '2099-01-01'::timestamptz FROM guided_rollback_fixture;
UPDATE public.workflow_executions SET status='running', current_node_id='condition-retry',
  guided_condition_retry_node_id='condition-retry',
  guided_condition_retry_count=2, guided_condition_retry_error='history_sync_in_progress'
  WHERE workflow_id=(SELECT workflow_id FROM guided_rollback_fixture);
${productRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_product_relation(uuid,uuid,uuid,text,text,uuid)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_product_relation(uuid,uuid,uuid,uuid,text,text,uuid)') IS NOT NULL
    OR public.valid_guided_data_scopes(ARRAY['product.trigger_business_item'])
    OR public.valid_guided_data_scopes(ARRAY['product.lead_association'])
    OR public.valid_guided_data_scopes(ARRAY['product.won_deal_history'])
    OR pg_get_functiondef('public.can_read_guided_execution_data(uuid,uuid,uuid)'::regprocedure) LIKE '%products.view%' THEN
    RAISE EXCEPTION 'product-relation rollback incomplete';
  END IF;
END $$;
${followUpRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date)') IS NOT NULL
    OR public.valid_guided_data_scopes(ARRAY['activity.follow_up'])
    OR pg_get_functiondef('public.can_read_guided_execution_data(uuid,uuid,uuid)'::regprocedure) LIKE '%followups.view%' THEN
    RAISE EXCEPTION 'follow-up rollback incomplete';
  END IF;
END $$;
${historySecurityRollback}
DO $$ BEGIN
  IF to_regprocedure('public.get_workflow_execution_history(uuid,integer)') IS NOT NULL
    OR to_regprocedure('public.get_workflow_execution_steps(uuid)') IS NOT NULL
    OR to_regprocedure('public.get_workflow_execution_stats(uuid)') IS NOT NULL
    OR to_regprocedure('public.retry_workflow_execution(uuid)') IS NOT NULL
    OR to_regprocedure('public.can_read_guided_execution_data(uuid,uuid,uuid)') IS NOT NULL
    OR NOT has_function_privilege('authenticated', 'public.claim_workflow_executions(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'execution-history rollback incomplete';
  END IF;
  IF pg_get_functiondef('public.pin_guided_execution_version()'::regprocedure) LIKE '%app.guided_retry_version%' THEN
    RAISE EXCEPTION 'execution-history rollback retained retry pin override';
  END IF;
END $$;
${conditionRetryRollback}
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workflow_executions'
    AND column_name IN ('guided_condition_retry_node_id','guided_condition_retry_count','guided_condition_retry_error')) THEN
    RAISE EXCEPTION 'guided-condition retry rollback left state columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_executions e JOIN guided_rollback_fixture f USING(workflow_id)) THEN
    RAISE EXCEPTION 'guided-condition retry rollback removed execution';
  END IF;
END $$;
${messageWaitingRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_message_waiting(uuid,uuid,jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_message_waiting(uuid,uuid,uuid,jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.guided_message_waiting_payload(uuid,uuid,jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_message_waiting_version()') IS NOT NULL
    OR public.valid_guided_data_scopes(ARRAY['message.waiting.elapsed']) THEN
    RAISE EXCEPTION 'message-waiting rollback left callable objects or scope';
  END IF;
END $$;
${messageSearchRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text)') IS NOT NULL
    OR to_regprocedure('public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text)') IS NOT NULL
    OR to_regprocedure('public.guided_message_search_matches(text,text[],text,text)') IS NOT NULL
    OR to_regprocedure('public.guided_normalize_message_search(text)') IS NOT NULL
    OR to_regprocedure('public.valid_guided_message_search_rule(jsonb)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_message_search_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'message-search rollback left callable objects';
  END IF;
END $$;
${messageCoverageRollback}
${messageCandidatesRollback}
${triggerMessageRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_message_candidates(uuid,uuid,text,uuid,text)') IS NOT NULL
    OR to_regprocedure('public.test_guided_condition_trigger_message(uuid,uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_trigger_message(uuid,uuid,uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_trigger_message_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'trigger-message rollback left callable objects';
  END IF;
  IF public.valid_guided_data_scopes(ARRAY['message.trigger.text']) THEN
    RAISE EXCEPTION 'trigger-message scope survived rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('whatsapp_messages','channel_messages')
    AND column_name IN ('condition_text','condition_text_source','transcription_text','transcription_provider','transcription_created_at')) THEN
    RAISE EXCEPTION 'trigger-message rollback left provenance columns';
  END IF;
END $$;
${lastWonRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_last_won(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_last_won(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_last_won_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'last-won rollback left callable objects';
  END IF;
  IF public.valid_guided_data_scopes(ARRAY['business.last_won_date']) THEN
    RAISE EXCEPTION 'last-won scope survived rollback';
  END IF;
END $$;
${businessExistenceRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_business_candidates(uuid,uuid,text[],jsonb)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_business_candidates(uuid,uuid,uuid,text[],jsonb)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_business_existence_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'business-existence rollback left callable objects';
  END IF;
  IF public.valid_guided_data_scopes(ARRAY['business.exists.lifecycle']) THEN
    RAISE EXCEPTION 'business-existence scope survived rollback';
  END IF;
END $$;
${businessElapsedRollback}
DO $$ BEGIN
  IF to_regprocedure('public.validate_guided_trigger_business_stage_elapsed_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'trigger-business elapsed rollback left trigger function';
  END IF;
  IF public.valid_guided_data_scopes(ARRAY['business.trigger.stage_elapsed']) THEN
    RAISE EXCEPTION 'trigger-business elapsed scope survived rollback';
  END IF;
END $$;
${businessValueRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_trigger_business_data(uuid,uuid,uuid,text[],jsonb)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_trigger_business_data(uuid,uuid,uuid,uuid,text[],jsonb)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_trigger_business_value_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'trigger-business value rollback left callable objects';
  END IF;
  IF public.valid_guided_data_scopes(ARRAY['business.trigger.value']) THEN
    RAISE EXCEPTION 'trigger-business value scope survived rollback';
  END IF;
END $$;
${businessVolatilityRollback}
${businessAuthorizationRollback}
${businessPersonalRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('public.validate_guided_trigger_business_stage_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'trigger-business rollback left callable objects';
  END IF;
END $$;
${stageClockRollback}
${limitRollback}
${selectRollback}
${optionsRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_custom_options(uuid,uuid,uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left personal options reader enabled';
  END IF;
END $$;
${dateRollback}
${booleanRollback}
${numericRollback}
${customPublicationRollback}
${customOrgRollback}
DO $$ BEGIN
  IF to_regprocedure('public.read_guided_condition_custom_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'custom organizational reader remains after rollback';
  END IF;
END $$;
${customRollback}
DO $$ BEGIN
  IF to_regprocedure('public.test_guided_condition_custom_fields(uuid,uuid,uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'personal custom field reader remains after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_custom_field_values v
    JOIN guided_rollback_fixture f ON f.custom_field_id = v.field_id AND f.custom_lead_id = v.lead_id
    JOIN public.lead_custom_fields d ON d.id = v.field_id AND d.organization_id = f.org_id
    WHERE v.value = 'Preserved custom answer' AND d.field_type = 'select' AND d.field_options = '["Preserved custom answer","Another option"]'::jsonb) THEN
    RAISE EXCEPTION 'custom field definition or answer lost during rollback';
  END IF;
END $$;
${profileRollback}
${presenceRollback}
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
    WHERE g.revision = 7 AND g.fields = (ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] || ARRAY['lead.custom:' || custom_field_id::text])) THEN
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
      AND v.required_fields = (ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] || ARRAY['lead.custom:' || custom_field_id::text])) THEN
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
-- Restore the complete field contract without narrowing retained grants.
${customOrgForward}
${customPublicationForward}
${numericForward}
${booleanForward}
${dateForward}
${optionsForward}
${selectForward}


${tagForward}
${originForward}
${responsibleForward}
${catalogueForward}
${customForward}
${limitForward}
${stageClockForward}
${businessPersonalForward}
${businessAuthorizationForward}
${businessVolatilityForward}
${businessValueForward}
${businessElapsedForward}
${businessExistenceForward}
${lastWonForward}
${triggerMessageForward}
${messageCandidatesForward}
${messageCoverageForward}
${messageSearchForward}
${messageWaitingForward}
${conditionRetryForward}
${historySecurityForward}
${followUpForward}
${productForward}
DO $$ BEGIN
  IF has_function_privilege('anon','public.test_guided_condition_product_relation(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.test_guided_condition_product_relation(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.test_guided_condition_product_relation(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.read_guided_condition_product_relation(uuid,uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.read_guided_condition_product_relation(uuid,uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.read_guided_condition_product_relation(uuid,uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.guided_product_relation_result(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.guided_product_relation_result(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.guided_product_relation_result(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
    OR NOT public.valid_guided_data_scopes(ARRAY['product.trigger_business_item','product.lead_association','product.won_deal_history'])
    OR pg_get_functiondef('public.can_read_guided_execution_data(uuid,uuid,uuid)'::regprocedure) NOT LIKE '%products.view%'
    OR pg_get_functiondef('public.can_read_guided_execution_data(uuid,uuid,uuid)'::regprocedure) NOT LIKE '%product.trigger_business_item%' THEN
    RAISE EXCEPTION 'product-relation reapply privileges invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon','public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR has_function_privilege('service_role','public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR has_function_privilege('anon','public.guided_follow_up_result(uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR has_function_privilege('authenticated','public.guided_follow_up_result(uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR has_function_privilege('service_role','public.guided_follow_up_result(uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR has_function_privilege('anon','public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR has_function_privilege('authenticated','public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date)','EXECUTE')
    OR NOT public.valid_guided_data_scopes(ARRAY['activity.follow_up'])
    OR pg_get_functiondef('public.can_read_guided_execution_data(uuid,uuid,uuid)'::regprocedure) NOT LIKE '%followups.view%' THEN
    RAISE EXCEPTION 'follow-up reapply privileges invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.get_workflow_execution_history(uuid,integer)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_workflow_execution_history(uuid,integer)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.get_workflow_execution_history(uuid,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_workflow_execution_steps(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_workflow_execution_steps(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.get_workflow_execution_steps(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.can_read_guided_execution_data(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.can_read_guided_execution_data(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.can_read_guided_execution_data(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.retry_workflow_execution(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.retry_workflow_execution(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.claim_workflow_executions(integer,integer)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.claim_workflow_executions(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'execution-history privileges invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workflow_executions'
      AND policyname='workflow_executions_select')
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workflow_execution_steps'
      AND policyname='workflow_execution_steps_select') THEN
    RAISE EXCEPTION 'raw execution-history policies survived';
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='workflow_executions'
    AND column_name IN ('guided_condition_retry_node_id','guided_condition_retry_count','guided_condition_retry_error')) <> 3
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_executions_guided_condition_retry_state_check'
      AND conrelid='public.workflow_executions'::regclass)
    OR NOT EXISTS (SELECT 1 FROM public.workflow_executions e JOIN guided_rollback_fixture f USING(workflow_id)
      WHERE e.guided_condition_retry_node_id IS NULL AND e.guided_condition_retry_count=0
        AND e.guided_condition_retry_error IS NULL) THEN
    RAISE EXCEPTION 'guided-condition retry state not restored safely';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_message_waiting(uuid,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_message_waiting(uuid,uuid,jsonb,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_message_waiting(uuid,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_message_waiting(uuid,uuid,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_message_waiting(uuid,uuid,uuid,jsonb,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_message_waiting(uuid,uuid,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.guided_message_waiting_payload(uuid,uuid,jsonb,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.guided_message_waiting_payload(uuid,uuid,jsonb,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.guided_message_waiting_payload(uuid,uuid,jsonb,text)', 'EXECUTE')
    OR NOT public.valid_guided_data_scopes(ARRAY['message.waiting.elapsed']) THEN
    RAISE EXCEPTION 'message-waiting reapply privileges or scope invalid';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.guided_normalize_message_search(text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.guided_message_search_matches(text,text[],text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'message-search reapply privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['message.search.text']) THEN
    RAISE EXCEPTION 'message-search scope not restored';
  END IF;
  IF public.guided_normalize_message_search(E' PREÇO,\n final! ') <> 'preco final'
    OR public.guided_message_search_matches('apreço',ARRAY['preço'],'whole_phrase','any')
    OR NOT public.guided_message_search_matches('apreço',ARRAY['preço'],'substring','any') THEN
    RAISE EXCEPTION 'message-search normalization not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_trigger_message(uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_trigger_message(uuid,uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_trigger_message(uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.test_guided_condition_message_candidates(uuid,uuid,text,uuid,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_message_candidates(uuid,uuid,text,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_message_candidates(uuid,uuid,text,uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_trigger_message(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_trigger_message(uuid,uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger-message reapply privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['message.trigger.text']) THEN
    RAISE EXCEPTION 'trigger-message scope not restored';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('whatsapp_messages','channel_messages')
    AND column_name IN ('condition_text','condition_text_source','transcription_text','transcription_provider','transcription_created_at')) <> 10 THEN
    RAISE EXCEPTION 'trigger-message provenance columns not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_last_won(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_last_won(uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_last_won(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_last_won(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_last_won(uuid,uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_last_won(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.validate_guided_last_won_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_guided_last_won_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.validate_guided_last_won_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'last-won reapply privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['business.last_won_date']) THEN
    RAISE EXCEPTION 'last-won scope not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_business_candidates(uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_business_candidates(uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_business_candidates(uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_business_candidates(uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_business_candidates(uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_business_candidates(uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.validate_guided_business_existence_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_guided_business_existence_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.validate_guided_business_existence_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'business-existence reapply privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['business.exists.lifecycle','business.exists.stage','business.exists.value']) THEN
    RAISE EXCEPTION 'business-existence scopes not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.validate_guided_trigger_business_stage_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_guided_trigger_business_stage_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.validate_guided_trigger_business_stage_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger-business reapply privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['business.trigger.stage']) THEN
    RAISE EXCEPTION 'trigger-business scope not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.validate_guided_trigger_business_stage_elapsed_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_guided_trigger_business_stage_elapsed_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.validate_guided_trigger_business_stage_elapsed_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger-business elapsed trigger privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed']) THEN
    RAISE EXCEPTION 'trigger-business elapsed scope not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_trigger_business_data(uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_trigger_business_data(uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_trigger_business_data(uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.read_guided_condition_trigger_business_data(uuid,uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_trigger_business_data(uuid,uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_trigger_business_data(uuid,uuid,uuid,uuid,text[],jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.validate_guided_trigger_business_value_version()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_guided_trigger_business_value_version()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.validate_guided_trigger_business_value_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger-business value reapply privileges invalid';
  END IF;
  IF NOT public.valid_guided_data_scopes(ARRAY['business.trigger.stage','business.trigger.value']) THEN
    RAISE EXCEPTION 'trigger-business value scope not restored';
  END IF;
END $$;
DO $$ BEGIN
  IF pg_get_functiondef('public.set_pipeline_entry_stage_changed()'::regprocedure)
    IS DISTINCT FROM (SELECT original_stage_clock_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'stage clock not restored exactly';
  END IF;
  IF has_function_privilege('anon', 'public.set_pipeline_entry_stage_changed()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.set_pipeline_entry_stage_changed()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.set_pipeline_entry_stage_changed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'stage clock callable directly';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_custom_options(uuid,uuid,uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_custom_options(uuid,uuid,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_custom_options(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'personal options reader privileges invalid';
  END IF;
  IF pg_get_functiondef('public.test_guided_condition_custom_options(uuid,uuid,uuid[])'::regprocedure)
    IS DISTINCT FROM (SELECT original_options_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'personal options reader not restored exactly';
  END IF;
END $$;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.read_guided_condition_custom_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.read_guided_condition_custom_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.read_guided_condition_custom_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'custom organization reader privileges invalid';
  END IF;
  IF pg_get_functiondef('public.read_guided_condition_custom_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[])'::regprocedure)
    IS DISTINCT FROM (SELECT original_custom_org_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'custom organizational reader not restored exactly';
  END IF;
END $$;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.test_guided_condition_custom_fields(uuid,uuid,uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.test_guided_condition_custom_fields(uuid,uuid,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.test_guided_condition_custom_fields(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'personal custom field test grants invalid';
  END IF;
  IF pg_get_functiondef('public.test_guided_condition_custom_fields(uuid,uuid,uuid[])'::regprocedure)
    IS DISTINCT FROM (SELECT original_custom_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'personal custom reader not restored exactly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_custom_field_values v
    JOIN guided_rollback_fixture f ON f.custom_field_id = v.field_id AND f.custom_lead_id = v.lead_id
    WHERE v.value = 'Preserved custom answer' AND EXISTS (SELECT 1 FROM public.lead_custom_fields d WHERE d.id = f.custom_field_id
      AND d.field_type = 'select' AND d.field_options = '["Preserved custom answer","Another option"]'::jsonb)) THEN
    RAISE EXCEPTION 'custom answer lost during recovery';
  END IF;
END $$;
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
    WHERE g.revision = 7 AND g.fields = (ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] || ARRAY['lead.custom:' || custom_field_id::text])) THEN
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
      AND v.required_fields = (ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id'] || ARRAY['lead.custom:' || custom_field_id::text])) THEN
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
  IF pg_get_functiondef('public.pin_guided_execution_version()'::regprocedure)
    NOT LIKE '%app.guided_retry_version%' THEN
    RAISE EXCEPTION 'retry-aware pin definition not restored';
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
  IF pg_get_functiondef('public.set_workflow_data_grant(uuid,text[],integer)'::regprocedure)
    IS DISTINCT FROM (SELECT original_definition FROM guided_rollback_fixture) THEN
    RAISE EXCEPTION 'grant writer not restored exactly';
  END IF;
  IF has_function_privilege('anon', 'public.valid_guided_data_scopes(text[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.valid_guided_data_scopes(text[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.valid_guided_data_scopes(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'scope validator privileges invalid';
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
