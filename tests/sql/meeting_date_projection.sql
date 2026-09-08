DO $$
DECLARE
 e uuid := '00000000-0000-0000-0000-000000000001';
 org uuid := '00000000-0000-0000-0000-000000000010';
 pipe uuid := '00000000-0000-0000-0000-000000000020';
 lead uuid := '00000000-0000-0000-0000-000000000030';
 m uuid := '00000000-0000-0000-0000-000000000040';
 d uuid := '00000000-0000-0000-0000-000000000050';
 other_entry uuid := gen_random_uuid();
 other_org uuid := gen_random_uuid();
 other_pipe uuid := gen_random_uuid();
 v jsonb;
BEGIN
 SELECT metadata INTO v FROM pipeline_entries WHERE id=e;
 ASSERT (v->>'meeting_date')::timestamptz = '2026-09-08 15:00:00+00', 'legacy recovery';
 ASSERT v->>'keep' = 'value', 'unrelated metadata preserved';
 ASSERT NOT has_function_privilege('authenticated',
   'fn_meeting_projection_entry(uuid,uuid,uuid,uuid)', 'EXECUTE'), 'resolver must not expose tenant data';
 ASSERT NOT has_function_privilege('authenticated',
   'fn_espelho_limpa_projecao(uuid,uuid,uuid,text)', 'EXECUTE'), 'cleanup must not bypass RLS via RPC';

 UPDATE meetings SET start_at='2026-09-09 16:00:00+00' WHERE id=m;
 ASSERT (SELECT (metadata->>'meeting_date')::timestamptz FROM pipeline_entries WHERE id=e)
   = '2026-09-09 16:00:00+00', 'reschedule legacy card';
 UPDATE meetings SET status='cancelled' WHERE id=m;
 ASSERT (SELECT NOT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=e), 'cancel legacy';
 UPDATE meetings SET status='scheduled' WHERE id=m;
 DELETE FROM meetings WHERE id=m;
 ASSERT (SELECT NOT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=e), 'delete legacy';

 -- A prefilled lead/pipeline with no deal still projects on insert.
 UPDATE pipeline_entries SET deal_id=d WHERE id=e;
 INSERT INTO meetings (id,organization_id,pipeline_id,lead_id,start_at)
 VALUES (m,org,pipe,lead,'2026-09-10 15:00:00+00');
 ASSERT (SELECT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=e), 'prefilled card with deal';

 INSERT INTO pipeline_entries VALUES (other_entry,org,other_pipe,lead,NULL,NULL,'{}');
 UPDATE meetings SET pipeline_id=other_pipe WHERE id=m;
 ASSERT (SELECT NOT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=e), 'old pipeline cleaned';
 ASSERT (SELECT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=other_entry), 'new pipeline projected';
 UPDATE meetings SET event_type='call' WHERE id=m;
 ASSERT (SELECT NOT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=other_entry), 'call clears date';

 -- Closed entries do not make a unique open match ambiguous.
 INSERT INTO pipeline_entries VALUES (gen_random_uuid(),org,pipe,lead,NULL,now(),'{}');
 ASSERT fn_meeting_projection_entry(org,NULL,pipe,lead)=e, 'closed excluded';
 INSERT INTO pipeline_entries VALUES (gen_random_uuid(),org,pipe,lead,NULL,NULL,'{}');
 ASSERT fn_meeting_projection_entry(org,NULL,pipe,lead) IS NULL, 'multiple open cards ambiguous';
 ASSERT fn_meeting_projection_entry(org,d,pipe,lead)=e, 'explicit deal disambiguates';
 ASSERT fn_meeting_projection_entry(other_org,d,pipe,lead) IS NULL, 'foreign org denied';
 ASSERT fn_meeting_projection_entry(org,d,other_pipe,lead) IS NULL, 'mismatched pipeline denied';
 ASSERT fn_meeting_projection_entry(org,NULL,NULL,lead) IS NULL, 'no pipeline no guess';

 UPDATE meetings SET event_type='meeting',pipeline_id=pipe,deal_id=NULL WHERE id=m;
 ASSERT (SELECT NOT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=e), 'ambiguous meeting no write';
 UPDATE meetings SET deal_id=d WHERE id=m;
 ASSERT (SELECT metadata ? 'meeting_date' FROM pipeline_entries WHERE id=e), 'explicit projection';
 UPDATE pipeline_entries SET metadata=metadata || '{"meeting_date":"2026-10-01T10:00:00Z"}' WHERE id=e;
 UPDATE meetings SET status='cancelled' WHERE id=m;
 ASSERT (SELECT metadata->>'meeting_date' FROM pipeline_entries WHERE id=e)='2026-10-01T10:00:00Z', 'manual date survives';

 UPDATE meetings SET status='scheduled' WHERE id=m;
 INSERT INTO meetings (id,organization_id,pipeline_id,lead_id,deal_id,start_at)
 VALUES (gen_random_uuid(),org,pipe,lead,d,'2026-10-02 15:00:00+00');
 DELETE FROM meetings WHERE id=m;
 ASSERT (SELECT (metadata->>'meeting_date')::timestamptz FROM pipeline_entries WHERE id=e)
   = '2026-10-02 15:00:00+00', 'another meeting owns projection';
END $$;
