-- Revert SQL37 only after any accepted incoming notifications finish.
-- Completed provider_notification audit remains intact.
BEGIN;
LOCK TABLE public.whatsapp_ingress_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
    WHERE status <> 'completed'
      AND payload->'event'->'IsFromMe' = 'false'::jsonb
      AND public.is_whatsapp_file_download_notification(payload)) THEN
    RAISE EXCEPTION 'incoming notification rollback requires drained inbox' USING ERRCODE='55000';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.is_whatsapp_file_download_notification(p_payload jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_event jsonb; v_ids jsonb; v_key text; v_url text; v_port text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR p_payload->>'EventType' IS DISTINCT FROM 'messages_update'
    OR p_payload->>'type' IS DISTINCT FROM 'FileDownloadedMessage'
    OR p_payload->>'state' IS DISTINCT FROM 'FileDownloaded'
    OR pg_catalog.jsonb_typeof(p_payload->'event') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_payload) AS key LOOP
    IF v_key <> ALL(ARRAY['type','event','owner','state','token','BaseUrl','EventType','instanceName'])
      THEN RETURN false; END IF;
  END LOOP;
  v_event := p_payload->'event';
  v_ids := v_event->'MessageIDs';
  v_url := v_event->>'FileURL';
  IF v_event->>'Type' IS DISTINCT FROM 'FileDownloaded'
    OR v_event->'IsFromMe' IS DISTINCT FROM 'true'::jsonb
    OR pg_catalog.jsonb_typeof(v_ids) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF pg_catalog.jsonb_array_length(v_ids) <> 1
    OR pg_catalog.jsonb_typeof(v_ids->0) IS DISTINCT FROM 'string'
    OR pg_catalog.btrim(v_ids->>0) = ''
    OR pg_catalog.btrim(v_ids->>0) IS DISTINCT FROM v_ids->>0
    OR pg_catalog.jsonb_typeof(v_event->'chatid') IS DISTINCT FROM 'string'
    OR pg_catalog.btrim(v_event->>'chatid') = ''
    OR pg_catalog.btrim(v_event->>'chatid') IS DISTINCT FROM v_event->>'chatid'
    OR v_event->>'Chat' IS DISTINCT FROM v_event->>'chatid'
    OR pg_catalog.jsonb_typeof(v_event->'FileURL') IS DISTINCT FROM 'string'
    OR v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?][^#[:space:]]*)?$' THEN
    RETURN false;
  END IF;
  v_port := substring(v_url FROM '^https://[A-Za-z0-9.-]+:([0-9]{1,5})([/?]|$)');
  IF v_port IS NOT NULL AND v_port::integer > 65535 THEN RETURN false; END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(v_event) AS key LOOP
    IF v_key <> ALL(ARRAY['Chat','Type','Sender','chatid','FileURL','IsGroup','chatlid',
      'IsFromMe','MimeType','Timestamp','sender_pn','MessageIDs','sender_lid'])
      THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.is_whatsapp_file_download_notification(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_whatsapp_file_download_notification(jsonb) TO service_role;
COMMIT;
