-- A contact from another business unit may use the same organization/inbox.
-- Do not modify its custom data unless it is in a configured commercial funnel.
DO $$
DECLARE definition text; previous text := 'IF NOT FOUND OR coalesce(NEW.timestamp,NEW.created_at)<c.enabled_at';
BEGIN
 definition:=pg_get_functiondef('private.regional_capture_contact()'::regprocedure);
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Unexpected contact capture implementation'; END IF;
 EXECUTE replace(definition,previous,'IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.pipeline_entries pe WHERE pe.organization_id=NEW.organization_id AND pe.lead_id=NEW.lead_id AND pe.pipeline_id=ANY(c.pipeline_ids)) OR coalesce(NEW.timestamp,NEW.created_at)<c.enabled_at');
END $$;
