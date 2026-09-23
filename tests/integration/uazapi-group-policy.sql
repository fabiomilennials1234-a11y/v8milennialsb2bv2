DO $test$
DECLARE org uuid:='10000000-0000-0000-0000-000000000001'; other_org uuid:='10000000-0000-0000-0000-000000000002';
 i uuid:='20000000-0000-0000-0000-000000000001'; j uuid:='20000000-0000-0000-0000-000000000002';
 a jsonb; b jsonb; value boolean; sig text;
BEGIN
 FOREACH sig IN ARRAY ARRAY['request_uazapi_group_capture(uuid,boolean)','prepare_uazapi_group_webhook(uuid,uuid,boolean)','finish_uazapi_group_webhook(uuid,uuid,uuid,bigint,boolean)','recover_uazapi_group_webhook(uuid,uuid,uuid,boolean)'] LOOP
  IF has_function_privilege('anon','public.'||sig,'EXECUTE') OR has_function_privilege('authenticated','public.'||sig,'EXECUTE') OR NOT has_function_privilege('service_role','public.'||sig,'EXECUTE') THEN RAISE EXCEPTION 'bad privileges: %',sig; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.uazapi_group_policy'::regclass,'public.uazapi_group_webhook_state'::regclass) AND relrowsecurity)<>2 THEN RAISE EXCEPTION 'RLS missing'; END IF;
 IF public.prepare_uazapi_group_webhook(i,org,false) IS NOT NULL THEN RAISE EXCEPTION 'legacy off changed'; END IF;
 BEGIN PERFORM public.prepare_uazapi_group_webhook(i,other_org,true); RAISE EXCEPTION 'cross tenant accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%instance_scope_denied%' THEN RAISE; END IF; END;
 PERFORM public.request_uazapi_group_capture(org,false);
 a:=public.prepare_uazapi_group_webhook(i,org,true);
 IF NOT (a->>'exclude_groups')::boolean THEN RAISE EXCEPTION 'eligible filter absent'; END IF;
 UPDATE public.uazapi_group_webhook_state SET lease_started_at=now()-interval '1 day' WHERE instance_id=i;
 BEGIN PERFORM public.prepare_uazapi_group_webhook(i,org,true); RAISE EXCEPTION 'lease stolen'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%in_progress_or_uncertain%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.request_uazapi_group_capture(org,true); RAISE EXCEPTION 'busy intent accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%in_progress_or_uncertain%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.organizations SET capture_groups=true WHERE id=org; RAISE EXCEPTION 'unsafe capture accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%use_request_uazapi%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.finish_uazapi_group_webhook(i,org,(a->>'token')::uuid,999,true); RAISE EXCEPTION 'stale revision accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%stale_or_unverified%' THEN RAISE; END IF; END;
 PERFORM public.finish_uazapi_group_webhook(i,org,(a->>'token')::uuid,(a->>'revision')::bigint,true);
 b:=public.prepare_uazapi_group_webhook(j,org,true); PERFORM public.finish_uazapi_group_webhook(j,org,(b->>'token')::uuid,(b->>'revision')::bigint,true);
 PERFORM public.request_uazapi_group_capture(org,true);
 a:=public.prepare_uazapi_group_webhook(i,org,true);
 IF (a->>'exclude_groups')::boolean THEN RAISE EXCEPTION 'activation excludes groups'; END IF;
 value:=public.finish_uazapi_group_webhook(i,org,(a->>'token')::uuid,(a->>'revision')::bigint,false);
 IF value THEN RAISE EXCEPTION 'activated before all instances'; END IF;
 b:=public.prepare_uazapi_group_webhook(j,org,false);
 value:=public.finish_uazapi_group_webhook(j,org,(b->>'token')::uuid,(b->>'revision')::bigint,false);
 IF NOT value THEN RAISE EXCEPTION 'activation incomplete'; END IF;
 BEGIN UPDATE public.organizations SET capture_groups=false WHERE id=org; RAISE EXCEPTION 'direct contradictory intent accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%use_request_uazapi%' THEN RAISE; END IF; END;
 PERFORM public.request_uazapi_group_capture(other_org,true);
 IF NOT (SELECT capture_groups FROM public.organizations WHERE id=other_org) THEN RAISE EXCEPTION 'zero-instance activation stranded'; END IF;
END $test$;
