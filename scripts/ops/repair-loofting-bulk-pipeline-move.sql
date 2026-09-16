-- Authorized Loofting cleanup, 2026-09-16. Run on the verified production
-- project only. Dry-run: replace final COMMIT with ROLLBACK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $repair$
DECLARE
  v_org constant uuid := '70b8775e-7cbc-4b6f-90ba-2011002e57f7';
  v_source constant uuid := 'e4ed88c4-5483-4f42-a90b-75946276ad81';
  v_target constant uuid := '5f03e620-8658-42a9-b826-33ccd1aa074e';
  v_stage constant uuid := 'b8461335-76cb-4b95-9b28-12a6b7a71705';
  v_originals uuid[] := ARRAY['535a421c-060d-4a07-b807-d8ab61b44ea7','b7b2b003-d2b3-4143-af0d-f36491b4ab7d','eb9cc2f2-e48b-4ff8-859b-4f900838f241','3ee31e5c-dace-4d95-9fb2-0d99c527c4fa','db6dcbf0-7228-4bb7-b805-7d63330dc724','2051a7ea-82ce-4bbc-bbe8-e0f8f5b722c6','a24efb9e-e73e-4787-a628-f32894f53f85','5a1faf61-907d-4e82-b813-d5e6ae8ab13c','cc0b3a60-f18e-452c-ad60-6d29aa18993b']::uuid[];
  v_copies uuid[] := ARRAY['34c3fef2-d190-4cb9-af48-83e78f25f904','f34be3cd-c62a-4ef7-a95e-f5d99f5bc302','2f6521f7-53f1-443a-80ad-abee51743ed8','c14f540c-d2c3-4e67-bc07-3959ca8a945b','71a1895a-c85b-43d7-b827-6fa6d9ec25b0','3855b978-6771-46fb-a2e5-178d17ec025f','0315d2a3-2096-4c37-93ba-e4bb9705487a','59724655-60ab-4868-92fe-4b7dae4e18e9','e6817586-31b9-4318-8c2c-9e56bb1063e8']::uuid[];
  v_ref record;
  v_count integer;
  v_snapshot jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM backup.pipeline_move_repair_snapshots WHERE repair_key='loofting-20260916-bulk-move') THEN
    RAISE EXCEPTION 'Repair already recorded: inspect final state instead of repeating.';
  END IF;
  PERFORM id FROM public.pipeline_entries WHERE id=ANY(v_originals || v_copies) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.pipeline_entries WHERE organization_id=v_org AND pipeline_id=v_source) <> 9
     OR (SELECT count(*) FROM public.pipeline_entries WHERE organization_id=v_org AND pipeline_id=v_target) <> 9 THEN
    RAISE EXCEPTION 'Pipeline counts changed; re-diagnose.';
  END IF;
  SELECT count(*) INTO v_count FROM unnest(v_originals,v_copies) AS pair(original,copy)
    JOIN public.pipeline_entries o ON o.id=pair.original
    JOIN public.pipeline_entries c ON c.id=pair.copy
    WHERE o.organization_id=v_org AND c.organization_id=v_org
      AND o.pipeline_id=v_source AND c.pipeline_id=v_target AND o.lead_id=c.lead_id
      AND o.deal_id IS NOT NULL AND c.deal_id IS NULL
      AND o.stage_key='novo' AND c.stage_id=v_stage AND c.stage_key='novo'
      AND c.metadata='{}'::jsonb AND c.notes IS NULL AND c.assigned_to IS NULL AND c.closed_at IS NULL
      AND c.created_at='2026-09-16 16:29:04.015616+00'::timestamptz
      AND c.updated_at=c.created_at;
  IF v_count<>9 THEN RAISE EXCEPTION 'Original/copy preconditions changed.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pipelines WHERE id=v_target AND organization_id=v_org AND NOT stage_dispatch_enabled)
     OR NOT EXISTS(SELECT 1 FROM public.pipeline_stages WHERE id=v_stage AND pipeline_id=v_target AND checklist_template_id IS NULL) THEN
    RAISE EXCEPTION 'Destination side effects changed.';
  END IF;
  -- Discover every declared FK, including cascading children, under row locks.
  FOR v_ref IN
    SELECT ns.nspname AS schema_name,cl.relname AS table_name,a.attname AS column_name
    FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
    JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=con.conkey[1]
    WHERE con.contype='f' AND con.confrelid='public.pipeline_entries'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=ANY($1)',v_ref.schema_name,v_ref.table_name,v_ref.column_name)
      INTO v_count USING v_copies;
    IF v_count<>0 THEN RAISE EXCEPTION 'Copy acquired dependencies in %.%',v_ref.schema_name,v_ref.table_name; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.lead_history WHERE entity_id=ANY(v_copies))
    OR (SELECT count(*) FROM public.pipeline_stage_events WHERE entry_id=ANY(v_copies))<>9
    OR EXISTS(SELECT 1 FROM public.pipeline_stage_events WHERE entry_id=ANY(v_copies)
      AND (from_stage_key IS NOT NULL OR from_pipeline_id IS NOT NULL OR to_stage_key<>'novo' OR pipeline_id<>v_target)) THEN
    RAISE EXCEPTION 'Copies acquired business history.';
  END IF;
  v_snapshot := jsonb_build_object(
    'original_ids',to_jsonb(v_originals),'copy_ids',to_jsonb(v_copies),
    'entries',(SELECT jsonb_agg(to_jsonb(e)) FROM public.pipeline_entries e WHERE e.id=ANY(v_originals || v_copies)),
    'stage_events',(SELECT jsonb_agg(to_jsonb(e)) FROM public.pipeline_stage_events e WHERE e.entry_id=ANY(v_originals || v_copies)),
    'deals',(SELECT jsonb_agg(to_jsonb(d)) FROM public.deals d WHERE d.id IN(SELECT deal_id FROM public.pipeline_entries WHERE id=ANY(v_originals))),
    'leads',(SELECT jsonb_agg(to_jsonb(l)) FROM public.leads l WHERE l.id IN(SELECT lead_id FROM public.pipeline_entries WHERE id=ANY(v_originals))),
    'reason','Keep original deal identities; remove nine empty copies produced by bulk_add_to_pipeline.');
  INSERT INTO backup.pipeline_move_repair_snapshots(repair_key,organization_id,snapshot)
    VALUES('loofting-20260916-bulk-move',v_org,v_snapshot);

  -- History is append-only: preserve even the copy creation events. The
  -- snapshot explains their removed entry IDs; original routes stay intact.
  DELETE FROM public.pipeline_entries WHERE organization_id=v_org AND id=ANY(v_copies);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>9 THEN RAISE EXCEPTION 'Unexpected copy deletion count.'; END IF;
  SELECT public.bulk_move_pipeline_entries(v_originals,v_source,v_target,v_stage) INTO v_count;
  IF v_count<>9
    OR EXISTS(SELECT 1 FROM public.pipeline_entries WHERE organization_id=v_org AND pipeline_id=v_source)
    OR (SELECT count(*) FROM public.pipeline_entries WHERE organization_id=v_org AND pipeline_id=v_target)<>9
    OR (SELECT count(*) FROM public.pipeline_entries WHERE id=ANY(v_originals) AND pipeline_id=v_target AND deal_id IS NOT NULL AND stage_id=v_stage)<>9
    OR (SELECT count(*) FROM public.pipeline_stage_events WHERE entry_id=ANY(v_originals) AND from_pipeline_id=v_source AND pipeline_id=v_target)<>9 THEN
    RAISE EXCEPTION 'Final counts, identities or route history failed.';
  END IF;
END;
$repair$;
SELECT p.name,count(e.id) AS entries FROM public.pipelines p
LEFT JOIN public.pipeline_entries e ON e.pipeline_id=p.id
WHERE p.organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'
GROUP BY p.id,p.name ORDER BY p.name;
COMMIT;
