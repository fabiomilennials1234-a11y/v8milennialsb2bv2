DO $test$
DECLARE
  oa uuid := '10000000-0000-0000-0000-000000000001';
  ob uuid := '20000000-0000-0000-0000-000000000002';
  ia uuid := 'a0000000-0000-0000-0000-000000000001';
  ib uuid := 'b0000000-0000-0000-0000-000000000002';
  a uuid; b uuid; c uuid; foreign_event uuid;
  first_event public.whatsapp_ingress_events%ROWTYPE;
  next_event public.whatsapp_ingress_events%ROWTYPE;
  old_token uuid;
  budget_rows bigint;
  budget_bytes bigint;
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['enqueue_whatsapp_ingress_event(uuid,uuid,text,jsonb,text)',
    'claim_whatsapp_ingress_events(uuid[],integer)','finish_whatsapp_ingress_event(uuid,uuid,text)',
    'cleanup_whatsapp_ingress_events(uuid[],integer)'] LOOP
    IF has_function_privilege('anon','public.'||sig,'EXECUTE') OR has_function_privilege('authenticated','public.'||sig,'EXECUTE')
      OR NOT has_function_privilege('service_role','public.'||sig,'EXECUTE') THEN RAISE EXCEPTION 'Unsafe grants: %',sig; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=('public.'||sig)::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=public']) THEN
      RAISE EXCEPTION 'Unsafe definer configuration: %',sig;
    END IF;
  END LOOP;
  IF has_table_privilege('anon','public.whatsapp_ingress_events','SELECT') OR has_table_privilege('authenticated','public.whatsapp_ingress_events','SELECT')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.whatsapp_ingress_events'::regclass) THEN RAISE EXCEPTION 'Unsafe inbox table'; END IF;
  IF has_table_privilege('service_role','public.whatsapp_ingress_events','INSERT')
    OR has_table_privilege('service_role','public.whatsapp_ingress_events','TRUNCATE')
    OR has_table_privilege('service_role','public.whatsapp_ingress_budget','UPDATE')
    OR has_table_privilege('service_role','public.whatsapp_ingress_budget','TRUNCATE') THEN
    RAISE EXCEPTION 'Service bypasses inbox budget'; END IF;
  BEGIN PERFORM public.enqueue_whatsapp_ingress_event(ob,ia,'messages_update','{}'); RAISE EXCEPTION 'Expected tenant rejection';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.claim_whatsapp_ingress_events(ARRAY[ia],NULL); RAISE EXCEPTION 'Expected NULL batch rejection';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.cleanup_whatsapp_ingress_events(ARRAY[ia],NULL); RAISE EXCEPTION 'Expected NULL cleanup rejection';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  a:=public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{"id":"same","pinned":true}');
  b:=public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{"id":"same","pinned":false}');
  c:=public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{"id":"same","pinned":true}');
  IF a=c THEN RAISE EXCEPTION 'A/B/A event was incorrectly deduplicated'; END IF;
  foreign_event:=public.enqueue_whatsapp_ingress_event(ob,ib,'messages_update','{}');
  SELECT * INTO first_event FROM public.claim_whatsapp_ingress_events(ARRAY[ia],10);
  IF first_event.id IS DISTINCT FROM a OR (SELECT count(*) FROM public.claim_whatsapp_ingress_events(ARRAY[ia],10))<>0 THEN
    RAISE EXCEPTION 'FIFO/active lease violation'; END IF;
  IF public.finish_whatsapp_ingress_event(a,gen_random_uuid()) THEN RAISE EXCEPTION 'Stale lease completed'; END IF;
  PERFORM public.finish_whatsapp_ingress_event(a,first_event.lease_token,'http_503');
  IF EXISTS(SELECT 1 FROM public.claim_whatsapp_ingress_events(ARRAY[ia],10)) THEN RAISE EXCEPTION 'Backoff allowed overtaking'; END IF;
  UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=a;
  SELECT * INTO first_event FROM public.claim_whatsapp_ingress_events(ARRAY[ia],1);
  old_token:=first_event.lease_token;
  UPDATE public.whatsapp_ingress_events SET lease_until=now()-interval '1 second' WHERE id=a;
  SELECT * INTO next_event FROM public.claim_whatsapp_ingress_events(ARRAY[ia],1);
  IF next_event.id IS DISTINCT FROM a OR next_event.lease_token=old_token OR public.finish_whatsapp_ingress_event(a,old_token) THEN
    RAISE EXCEPTION 'Restart lease fencing failed'; END IF;
  PERFORM public.finish_whatsapp_ingress_event(a,next_event.lease_token);
  SELECT * INTO first_event FROM public.claim_whatsapp_ingress_events(ARRAY[ia],10);
  IF first_event.id IS DISTINCT FROM b THEN RAISE EXCEPTION 'Unpin overtaken'; END IF;
  PERFORM public.finish_whatsapp_ingress_event(b,first_event.lease_token);
  SELECT * INTO first_event FROM public.claim_whatsapp_ingress_events(ARRAY[ia],10);
  IF first_event.id IS DISTINCT FROM c THEN RAISE EXCEPTION 'Second pin missing'; END IF;
  UPDATE public.whatsapp_ingress_events SET attempts=8 WHERE id=c;
  PERFORM public.finish_whatsapp_ingress_event(c,first_event.lease_token,'http_500');
  IF (SELECT status FROM public.whatsapp_ingress_events WHERE id=c)<>'dead_letter' THEN RAISE EXCEPTION 'Retry exhaustion lost'; END IF;
  UPDATE public.whatsapp_ingress_events SET completed_at=now()-interval '3 days' WHERE id IN(a,b);
  IF public.cleanup_whatsapp_ingress_events(ARRAY[ia],1)<>1 THEN RAISE EXCEPTION 'Cleanup limit failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.whatsapp_ingress_events WHERE id=c AND status='dead_letter')
    OR NOT EXISTS(SELECT 1 FROM public.whatsapp_ingress_events WHERE id=foreign_event AND status='pending') THEN
    RAISE EXCEPTION 'Cleanup lost unconfirmed/foreign work'; END IF;
  -- Explicit user deletion is intentional removal, unlike retention cleanup.
  DELETE FROM public.whatsapp_instances WHERE id=ib;
  IF EXISTS(SELECT 1 FROM public.whatsapp_ingress_events WHERE instance_id=ib) THEN RAISE EXCEPTION 'Instance deletion blocked/retained inbox'; END IF;
  IF EXISTS(SELECT 1 FROM public.whatsapp_ingress_budget WHERE row_count<>(SELECT count(*) FROM public.whatsapp_ingress_events)
    OR payload_bytes<>(SELECT coalesce(sum(payload_bytes),0) FROM public.whatsapp_ingress_events)) THEN
    RAISE EXCEPTION 'Cascade desynchronized capacity counter'; END IF;
  -- Small remote fixture: exercise exact quota boundaries by adjusting only
  -- its isolated private counter. Real insert/delete counter accounting was
  -- asserted above; the local PGlite test still fills all 20,000 rows.
  SELECT row_count,payload_bytes INTO budget_rows,budget_bytes FROM public.whatsapp_ingress_budget;
  UPDATE public.whatsapp_ingress_budget SET row_count=19999;
  PERFORM public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{"id":"boundary-final-slot"}');
  IF (SELECT row_count FROM public.whatsapp_ingress_budget)<>20000 THEN RAISE EXCEPTION 'Final quota slot not accounted'; END IF;
  budget_rows:=budget_rows+1;
  SELECT payload_bytes INTO budget_bytes FROM public.whatsapp_ingress_budget;
  BEGIN PERFORM public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{}'); RAISE EXCEPTION 'Expected capacity rejection';
    EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
  IF (SELECT count(*) FROM public.whatsapp_ingress_events)<>budget_rows THEN RAISE EXCEPTION 'Rejected row remained persisted'; END IF;
  UPDATE public.whatsapp_ingress_budget SET row_count=budget_rows,payload_bytes=67108864;
  BEGIN PERFORM public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{}'); RAISE EXCEPTION 'Expected byte capacity rejection';
    EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
  UPDATE public.whatsapp_ingress_budget SET payload_bytes=budget_bytes;
  PERFORM public.enqueue_whatsapp_ingress_event(oa,ia,'messages_update','{"id":"capacity-recovered"}');
  IF EXISTS(SELECT 1 FROM public.whatsapp_ingress_budget WHERE row_count<>(SELECT count(*) FROM public.whatsapp_ingress_events)
    OR payload_bytes<>(SELECT coalesce(sum(payload_bytes),0) FROM public.whatsapp_ingress_events)) THEN
    RAISE EXCEPTION 'Admission after quota recovery desynchronized counter'; END IF;
END $test$;
SELECT 'PASS: ingress DDL, tenant/ACL, FIFO, leases, retry, retention, synthetic quota boundaries; no network' AS validation;
