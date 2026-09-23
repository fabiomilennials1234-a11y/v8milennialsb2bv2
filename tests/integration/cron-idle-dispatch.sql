-- Run after the isolated fixture and migration. Fail hard on any assertion.
CREATE FUNCTION public.fixture_assert_dispatch(fn text, expected integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE actual integer;
BEGIN
  TRUNCATE public.fixture_http_calls;
  EXECUTE format('SELECT public.%I()', fn);
  SELECT count(*) INTO actual FROM public.fixture_http_calls;
  IF actual <> expected THEN
    RAISE EXCEPTION '%: expected % HTTP calls, got %', fn, expected, actual;
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixture_http_calls WHERE headers->>'x-cron-secret' <> 'fixture-secret') THEN
    RAISE EXCEPTION 'Cron authentication changed';
  END IF;
END;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['invoke_process_ai_actions', 'invoke_process_scheduled_user_messages',
    'invoke_history_sync_worker', 'invoke_send_push', 'invoke_copilot_v2_worker', 'invoke_mass_send_status',
    'invoke_whatsapp_media_retry', 'invoke_whatsapp_dlq_replay'] LOOP
    PERFORM public.fixture_assert_dispatch(fn, 0);
    IF has_function_privilege('anon', 'public.'||fn||'()', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.'||fn||'()', 'EXECUTE')
      OR NOT has_function_privilege('service_role', 'public.'||fn||'()', 'EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe execution grants: %', fn;
    END IF;
  END LOOP;
END;
$$;

-- AI retries remain deferred, terminal rows do not wake the worker.
INSERT INTO public.pending_ai_actions VALUES ('pending', now()+interval '1 hour', now()),
  ('completed', null, now()-interval '1 hour'), ('failed', null, now()-interval '1 hour'),
  ('dead_letter', null, now()-interval '1 hour'), ('processing', null, now());
SELECT public.fixture_assert_dispatch('invoke_process_ai_actions', 0);
INSERT INTO public.pending_ai_actions VALUES ('pending', now()-interval '1 second', now());
SELECT public.fixture_assert_dispatch('invoke_process_ai_actions', 1);
TRUNCATE public.pending_ai_actions;
INSERT INTO public.pending_ai_actions VALUES ('pending', null, now());
SELECT public.fixture_assert_dispatch('invoke_process_ai_actions', 1);
TRUNCATE public.pending_ai_actions;
INSERT INTO public.pending_ai_actions VALUES ('processing', null, now()-interval '11 minutes');
SELECT public.fixture_assert_dispatch('invoke_process_ai_actions', 1);
-- Existence check must never claim/mutate queue rows.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pending_ai_actions WHERE status='processing' AND updated_at < now()-interval '10 minutes') THEN
    RAISE EXCEPTION 'Dispatcher mutated recovery state';
  END IF;
END $$;
TRUNCATE public.pending_ai_actions;

INSERT INTO public.scheduled_user_messages VALUES ('scheduled', now()+interval '1 hour'),
  ('cancelled', now()-interval '1 hour'), ('sending', now()-interval '1 hour'), ('failed', now()-interval '1 hour');
SELECT public.fixture_assert_dispatch('invoke_process_scheduled_user_messages', 0);
INSERT INTO public.scheduled_user_messages VALUES ('scheduled', now()-interval '1 second');
SELECT public.fixture_assert_dispatch('invoke_process_scheduled_user_messages', 1);
DO $$ BEGIN
  IF (SELECT headers->>'Authorization' FROM public.fixture_http_calls) <> 'Bearer fixture-anon' THEN
    RAISE EXCEPTION 'Scheduled messages gateway auth changed';
  END IF;
END $$;
TRUNCATE public.scheduled_user_messages;

INSERT INTO public.history_sync_jobs VALUES ('paused','full',now()-interval '1 day'),
  ('cancelled','full',now()-interval '1 day'), ('completed','full',now()-interval '1 day'), ('running','full',now());
SELECT public.fixture_assert_dispatch('invoke_history_sync_worker', 0);
INSERT INTO public.history_sync_jobs VALUES ('running','full',now()-interval '11 minutes');
SELECT public.fixture_assert_dispatch('invoke_history_sync_worker', 1);
TRUNCATE public.history_sync_jobs;
-- Full jobs conservatively dispatch: only the worker enforces its UTC window.
INSERT INTO public.history_sync_jobs VALUES ('queued','full',now());
SELECT public.fixture_assert_dispatch('invoke_history_sync_worker', 1);
TRUNCATE public.history_sync_jobs;
INSERT INTO public.history_sync_jobs VALUES ('queued','chat',now());
SELECT public.fixture_assert_dispatch('invoke_history_sync_worker', 1);
DO $$ BEGIN
  IF (SELECT timeout_milliseconds FROM public.fixture_http_calls) <> 60000 THEN
    RAISE EXCEPTION 'History worker timeout changed';
  END IF;
END $$;
TRUNCATE public.history_sync_jobs;

INSERT INTO public.fixture_push_eligible VALUES ('00000000-0000-0000-0000-000000000001');
SELECT public.fixture_assert_dispatch('invoke_send_push', 1);
DO $$ BEGIN
  IF (SELECT timeout_milliseconds FROM public.fixture_http_calls) <> 30000 THEN
    RAISE EXCEPTION 'Push timeout changed';
  END IF;
END $$;
TRUNCATE public.fixture_push_eligible;
SELECT public.fixture_assert_dispatch('invoke_send_push', 0);

INSERT INTO public.copilot_v2_message_queue VALUES ('retry',now()+interval '1 hour'), ('processing',null), ('completed',null), ('failed',null);
SELECT public.fixture_assert_dispatch('invoke_copilot_v2_worker', 0);
INSERT INTO public.copilot_v2_message_queue VALUES ('pending',now()+interval '1 hour');
SELECT public.fixture_assert_dispatch('invoke_copilot_v2_worker', 1);
TRUNCATE public.copilot_v2_message_queue;
INSERT INTO public.copilot_v2_message_queue VALUES ('retry',null);
SELECT public.fixture_assert_dispatch('invoke_copilot_v2_worker', 1);
TRUNCATE public.copilot_v2_message_queue;
INSERT INTO public.copilot_v2_message_queue VALUES ('retry',now()-interval '1 second');
SELECT public.fixture_assert_dispatch('invoke_copilot_v2_worker', 1);
TRUNCATE public.copilot_v2_message_queue;

INSERT INTO public.uazapi_sender_jobs VALUES ('paused'),('cancelled'),('completed'),('failed');
SELECT public.fixture_assert_dispatch('invoke_mass_send_status', 0);
INSERT INTO public.uazapi_sender_jobs VALUES ('queued');
SELECT public.fixture_assert_dispatch('invoke_mass_send_status', 1);
TRUNCATE public.uazapi_sender_jobs;
INSERT INTO public.uazapi_sender_jobs VALUES ('running');
SELECT public.fixture_assert_dispatch('invoke_mass_send_status', 1);
DO $$ BEGIN
  IF (SELECT body FROM public.fixture_http_calls) <> '{"all_running":true}'::jsonb THEN
    RAISE EXCEPTION 'Mass-send cron payload changed';
  END IF;
END $$;
TRUNCATE public.uazapi_sender_jobs;

-- Last permitted attempt still dispatches; exhausted and resolved rows do not.
DO $$
DECLARE table_name text; fn text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['whatsapp_media_jobs', 'whatsapp_webhook_dlq'] LOOP
    fn := CASE table_name WHEN 'whatsapp_media_jobs' THEN 'invoke_whatsapp_media_retry' ELSE 'invoke_whatsapp_dlq_replay' END;
    EXECUTE format('INSERT INTO public.%I VALUES (now(), 0), (null, 5), (null, 9)', table_name);
    PERFORM public.fixture_assert_dispatch(fn, 0);
    EXECUTE format('INSERT INTO public.%I VALUES (null, 4)', table_name);
    PERFORM public.fixture_assert_dispatch(fn, 1);
    EXECUTE format('TRUNCATE public.%I', table_name);
    EXECUTE format('INSERT INTO public.%I VALUES (null, 0)', table_name);
    PERFORM public.fixture_assert_dispatch(fn, 1);
    EXECUTE format('TRUNCATE public.%I', table_name);
  END LOOP;
END $$;
