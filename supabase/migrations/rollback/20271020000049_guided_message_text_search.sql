BEGIN;
DROP TRIGGER IF EXISTS validate_guided_message_search_version ON public.workflow_guided_versions;
DROP FUNCTION IF EXISTS public.validate_guided_message_search_version();
DROP FUNCTION IF EXISTS public.valid_guided_message_search_rule(jsonb);
DROP FUNCTION IF EXISTS public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text);
DROP FUNCTION IF EXISTS public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text);
DROP FUNCTION IF EXISTS public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text);
DROP FUNCTION IF EXISTS public.guided_message_search_matches(text,text[],text,text);
DROP FUNCTION IF EXISTS public.guided_normalize_message_search(text);
-- valid_guided_data_scopes is restored by replaying migration 48.
COMMIT;
