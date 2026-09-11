BEGIN;
DROP TRIGGER IF EXISTS validate_guided_message_period_version ON public.workflow_guided_versions;
DROP FUNCTION IF EXISTS public.validate_guided_message_period_version();
DROP FUNCTION IF EXISTS public.read_guided_condition_message_period(uuid,uuid,uuid,jsonb,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public.test_guided_condition_message_period(uuid,uuid,jsonb,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public.guided_message_period_payload(uuid,uuid,jsonb,timestamptz,timestamptz);
DROP TABLE IF EXISTS public.conversation_history_coverage;
DROP FUNCTION IF EXISTS public.normalize_conversation_history_coverage_participant();
-- Restored by replaying migration 47 in the rollback rehearsal.
COMMIT;
