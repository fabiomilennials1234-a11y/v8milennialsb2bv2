DO $$
DECLARE n integer; job uuid; org uuid := gen_random_uuid(); lead uuid := gen_random_uuid(); inst uuid := gen_random_uuid();
BEGIN
  IF has_function_privilege('anon','public.claim_conversation_summary_jobs(integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_conversation_summary_jobs(integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_conversation_summary_jobs(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Invalid summary claim grants';
  END IF;
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n <> 0 THEN RAISE EXCEPTION 'Empty queue claimed'; END IF;

  -- New, sufficiently quiet direct conversation is discovered and leased.
  INSERT INTO public.whatsapp_conversation_summary VALUES(org,lead,inst,now()-interval '2 hours',false);
  SELECT id INTO job FROM public.claim_conversation_summary_jobs(10);
  IF job IS NULL OR NOT EXISTS(SELECT 1 FROM public.conversation_summary_jobs j
      WHERE j.id=job AND j.organization_id=org AND j.lead_id=lead AND j.instance_id=inst
        AND j.status='processing' AND j.attempts=1 AND j.lease_until>now()) THEN
    RAISE EXCEPTION 'New conversation not claimed with original scope';
  END IF;
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>0 THEN RAISE EXCEPTION 'Active lease claimed twice'; END IF;

  UPDATE public.conversation_summary_jobs SET lease_until=now()-interval '1 minute' WHERE id=job;
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>1 OR (SELECT attempts FROM public.conversation_summary_jobs WHERE id=job)<>2 THEN
    RAISE EXCEPTION 'Expired lease not recovered';
  END IF;

  UPDATE public.conversation_summary_jobs SET status='pending',next_attempt_at=now()+interval '1 hour',lease_until=NULL WHERE id=job;
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>0 THEN RAISE EXCEPTION 'Future retry ran early'; END IF;
  UPDATE public.conversation_summary_jobs SET next_attempt_at=now() WHERE id=job;
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>1 THEN RAISE EXCEPTION 'Due retry not claimed'; END IF;

  UPDATE public.conversation_summary_jobs SET status='completed',lease_until=NULL WHERE id=job;
  INSERT INTO public.conversation_summaries(organization_id,lead_id,instance_id,source_last_message_at)
    VALUES(org,lead,inst,now()-interval '2 hours');
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>0 THEN RAISE EXCEPTION 'Current summary regenerated'; END IF;
  UPDATE public.whatsapp_conversation_summary SET last_message_time=now()-interval '90 minutes';
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>1 OR (SELECT attempts FROM public.conversation_summary_jobs WHERE id=job)<>1 THEN
    RAISE EXCEPTION 'Stale summary did not reset the existing unique job';
  END IF;

  TRUNCATE public.conversation_summary_jobs,public.whatsapp_conversation_summary,public.conversation_summaries;
  INSERT INTO public.whatsapp_conversation_summary VALUES
    (org,lead,inst,now()-interval '2 hours',true),
    (org,gen_random_uuid(),inst,now()-interval '30 minutes',false),
    (org,NULL,inst,now()-interval '2 hours',false);
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>0 THEN RAISE EXCEPTION 'Group, recent or leadless conversation claimed'; END IF;
  TRUNCATE public.whatsapp_conversation_summary;

  INSERT INTO public.whatsapp_conversation_summary
    SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),now()-interval '2 hours',false FROM generate_series(1,25);
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(100);
  IF n<>20 THEN RAISE EXCEPTION 'Batch maximum not preserved'; END IF;
  SELECT count(*) INTO n FROM public.claim_conversation_summary_jobs(10);
  IF n<>5 THEN RAISE EXCEPTION 'Remaining work not claimed'; END IF;
END;
$$;
