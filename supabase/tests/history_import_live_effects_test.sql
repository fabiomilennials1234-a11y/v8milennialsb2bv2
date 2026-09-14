-- Execute inside a transaction and roll back. No customer rows are inserted.
-- Clone deployed trigger definitions onto a temporary table, replacing only
-- their business function with a recorder. This tests actual deployed WHENs.
CREATE TEMP TABLE history_trigger_probe (direction text, received_via text);
CREATE TEMP TABLE history_trigger_calls (trigger_name text);
CREATE FUNCTION pg_temp.record_history_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO history_trigger_calls VALUES (TG_NAME);
  RETURN NEW;
END;
$$;
DO $$
DECLARE
  t record;
  definition text;
  expected_triggers text[] := ARRAY['trg_aviso_de_mensagem', 'trg_enqueue_whatsapp_messages_webhooks',
    'trg_human_pause_on_manual_send', 'trg_whatsapp_response_detection'];
  found integer := 0;
BEGIN
  FOR t IN SELECT oid, tgname FROM pg_trigger
    WHERE tgrelid = 'public.whatsapp_messages'::regclass AND tgname = ANY(expected_triggers)
  LOOP
    definition := pg_get_triggerdef(t.oid);
    definition := replace(definition, 'ON public.whatsapp_messages', 'ON history_trigger_probe');
    definition := regexp_replace(definition, 'EXECUTE FUNCTION .+$', 'EXECUTE FUNCTION pg_temp.record_history_trigger()');
    EXECUTE definition;
    found := found + 1;
  END LOOP;
  IF found <> 4 THEN RAISE EXCEPTION 'Expected four live-effect triggers, got %', found; END IF;

  INSERT INTO history_trigger_probe VALUES ('incoming', 'history_sync'), ('outgoing', 'history_sync');
  IF EXISTS (SELECT FROM history_trigger_calls) THEN RAISE EXCEPTION 'Historical rows fired live effects'; END IF;

  INSERT INTO history_trigger_probe VALUES ('incoming', NULL), ('incoming', 'webhook'), ('outgoing', NULL);
  IF (SELECT count(*) FROM history_trigger_calls) <> 11 THEN RAISE EXCEPTION 'Live events lost'; END IF;
  IF (SELECT count(*) FROM history_trigger_calls WHERE trigger_name = 'trg_whatsapp_response_detection') <> 2
    THEN RAISE EXCEPTION 'Response detection must only fire for incoming live messages'; END IF;
END;
$$;
