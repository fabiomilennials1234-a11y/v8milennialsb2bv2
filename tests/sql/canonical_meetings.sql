DO $$
DECLARE
 org uuid := '10000000-0000-0000-0000-000000000001';
 lead uuid := '20000000-0000-0000-0000-000000000001';
 pipe uuid := '30000000-0000-0000-0000-000000000001';
 entry uuid := '40000000-0000-0000-0000-000000000001';
 booked uuid := '50000000-0000-0000-0000-000000000001';
 m uuid; other_entry uuid:=gen_random_uuid(); before_count int; outcome_id uuid;
BEGIN
 ASSERT NOT EXISTS ((SELECT * FROM meeting_events EXCEPT SELECT * FROM ledger_before) UNION ALL (SELECT * FROM ledger_before EXCEPT SELECT * FROM meeting_events)), 'backfill must preserve historical ledger byte for byte';
 SELECT id INTO m FROM meetings WHERE booked_event_id=booked;
 ASSERT m IS NOT NULL, 'Alex-like pipeline history materialized';
 ASSERT (SELECT status='completed' FROM meetings WHERE booked_event_id='50000000-0000-0000-0000-000000000002'), 'historical attendance preserved';
 ASSERT (SELECT status='no_show' FROM meetings WHERE booked_event_id='50000000-0000-0000-0000-000000000003'), 'explicit historical no-show preserved';
 ASSERT (SELECT status='scheduled' FROM meetings WHERE id=m), 'past date is not inferred absence';
 ASSERT (SELECT count(*)=1 FROM get_agenda_events(org,'2026-09-01','2026-10-01') WHERE source='meeting'), 'agenda includes canonical meeting once';
 ASSERT NOT EXISTS (SELECT 1 FROM get_agenda_events(org,'2026-09-01','2026-10-01') WHERE source IN ('meeting_event','pipe_confirmacao')), 'no legacy appointment projections';
 UPDATE pipeline_entries SET stage_key='compareceu' WHERE id=entry;
 ASSERT (SELECT status='scheduled' FROM meetings WHERE id=m), 'stage is not attendance';
 ASSERT (SELECT count(*)=1 FROM meeting_events WHERE organization_id=org), 'stage writes no metric';
 UPDATE pipeline_entries SET metadata=metadata||'{"meeting_date":"2026-09-03T18:00:00Z"}' WHERE id=entry;
 ASSERT (SELECT start_at='2026-09-03T18:00:00Z' FROM meetings WHERE id=m), 'explicit date reschedules existing meeting';
 ASSERT (SELECT count(*)=1 FROM meeting_events WHERE organization_id=org), 'reschedule does not duplicate booking';
 ASSERT (SELECT meeting_date='2026-09-03T18:00:00Z' FROM meeting_events WHERE id=booked), 'ledger date follows same booking';
 UPDATE meetings SET status='completed' WHERE id=m;
 ASSERT (SELECT count(*)=1 FROM meeting_events WHERE booked_event_id=booked AND event_type='meeting_held'), 'attendance written once';
 SELECT id INTO outcome_id FROM meeting_events WHERE booked_event_id=booked;
 UPDATE meetings SET status='completed' WHERE id=m;
 ASSERT (SELECT id=outcome_id FROM meeting_events WHERE booked_event_id=booked), 'retry preserves event identity and workflow delivery';
 UPDATE meetings SET status='no_show' WHERE id=m;
 ASSERT (SELECT count(*)=1 FROM meeting_events WHERE booked_event_id=booked), 'changing outcome never doubles';
 UPDATE meetings SET status='scheduled' WHERE id=m;
 ASSERT NOT EXISTS (SELECT 1 FROM meeting_events WHERE booked_event_id=booked), 'unmark removes outcome';
 SELECT count(*) INTO before_count FROM meeting_events;
 INSERT INTO pipeline_entries(id,organization_id,pipeline_id,lead_id,stage_key) VALUES(other_entry,org,pipe,lead,'agendado');
 UPDATE pipeline_entries SET stage_key='compareceu' WHERE id=other_entry;
 ASSERT (SELECT count(*)=before_count FROM meeting_events), 'undated stage transitions write no booking or outcome';
 UPDATE pipeline_entries SET metadata='{"meeting_date":"2026-09-03T18:00:00Z"}' WHERE id=other_entry;
 ASSERT (SELECT count(*)=2 FROM meetings WHERE lead_id=lead), 'two businesses for same lead/date remain separate';
 ASSERT (SELECT count(DISTINCT booked_event_id)=2 FROM meetings WHERE lead_id=lead), 'separate bookings for separate businesses';
 SELECT count(*) INTO before_count FROM meeting_events;
 INSERT INTO meetings(organization_id,lead_id,title,start_at,end_at,event_type,status) VALUES(org,lead,'Call','2026-09-04','2026-09-04 01:00','call','completed');
 ASSERT (SELECT count(*)=before_count FROM meeting_events), 'calls do not emit meeting metrics';
 BEGIN
   INSERT INTO meetings(organization_id,lead_id,start_at,end_at) VALUES(org,'20000000-0000-0000-0000-000000000002','2026-09-05','2026-09-05 01:00');
   RAISE EXCEPTION 'foreign lead accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   INSERT INTO meetings(organization_id,lead_id,start_at,end_at,booked_event_id) VALUES('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','2026-09-05','2026-09-05 01:00',booked);
   RAISE EXCEPTION 'foreign booking accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO meetings(organization_id,lead_id,title,start_at,end_at,status)
 VALUES(org,lead,'Already attended','2026-09-10','2026-09-10 01:00','completed');
 ASSERT NOT EXISTS(SELECT 1 FROM workflow_context wc WHERE NOT wc.found), 'outcome workflows must see the inserted meeting';
 ASSERT NOT has_function_privilege('authenticated','fn_pipeline_meeting_to_agenda(uuid)','EXECUTE'), 'internal writer unavailable via public RPC';
END $$;
