-- One-off operator repair, ticket 52b4f4ca. NOT an automatic migration.
-- Deletes only the five empty copies, after an explicit production approval.
-- Keeps the original entry/deal ids, outcome, history and every dependent row.
-- Full before-images are saved in lead_history in the same transaction.
-- Re-running is a no-op. Any changed precondition rolls back the whole batch.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $repair$
DECLARE
  pair record;
  original public.pipeline_entries%ROWTYPE;
  duplicate public.pipeline_entries%ROWTYPE;
  fk record;
  dependent_count bigint;
  repaired integer := 0;
  org constant uuid := '7af43ad3-17b0-4365-835b-3922511ef4de';
  destination constant uuid := '2238458b-6744-4c47-bfaa-78c6efd47a5c';
BEGIN
  FOR pair IN SELECT * FROM (VALUES
    ('67246e4a-3670-4ca3-ae72-03787539aae7'::uuid, '0e8b2369-3d3b-4a95-bcbe-183e058d9a32'::uuid),
    ('4d42be0a-5df9-4963-ba79-c82e452e6770'::uuid, '4100d526-f782-40a0-a850-04b4b385a4b8'::uuid),
    ('68c122d5-254f-4177-aaf7-057a7942e81a'::uuid, '1ab4e155-e434-43f0-868e-92e6752acc7c'::uuid),
    ('ff6ef192-26a0-42e5-b091-44f33b9640d3'::uuid, '10cb744d-abaa-4481-8a6d-c25c9ce92dfe'::uuid),
    ('7f91783b-ac70-4f64-b425-88acccef9377'::uuid, '3bc9d13f-83b5-433f-a825-cb8134c0153d'::uuid)
  ) AS pairs(original_id, duplicate_id) LOOP
    PERFORM id FROM public.pipeline_entries WHERE id IN (pair.original_id, pair.duplicate_id) ORDER BY id FOR UPDATE;
    SELECT * INTO original FROM public.pipeline_entries WHERE id = pair.original_id;
    SELECT * INTO duplicate FROM public.pipeline_entries WHERE id = pair.duplicate_id;
    IF original.id IS NOT NULL AND duplicate.id IS NULL
       AND original.organization_id = org AND original.pipeline_id = destination
       AND EXISTS (SELECT 1 FROM public.lead_history WHERE entity_id = original.id
                   AND metadata->>'repair_ticket' = '52b4f4ca-4ca8-41d9-aaa2-f721e303f22e') THEN
      CONTINUE;
    END IF;
    IF original.id IS NULL OR duplicate.id IS NULL
       OR original.organization_id <> org OR duplicate.organization_id <> org
       OR original.lead_id IS DISTINCT FROM duplicate.lead_id
       OR original.pipeline_id <> '49734af3-7c7c-425c-b895-aa210832a75c'::uuid
       OR original.stage_key <> 'novo_lead' OR original.closed_at IS NOT NULL
       OR duplicate.pipeline_id <> destination OR duplicate.stage_key <> 'em_andamento'
       OR duplicate.stage_id <> '29937b27-28b7-44e5-8551-969a0e5ffb30'::uuid
       OR duplicate.deal_id IS NOT NULL OR duplicate.closed_at IS NOT NULL
       OR duplicate.notes IS NOT NULL OR duplicate.assigned_to IS NOT NULL
       OR duplicate.metadata <> '{}'::jsonb
       OR NOT EXISTS (SELECT 1 FROM public.deals WHERE id = original.deal_id
                      AND organization_id = org AND source_lead_id = original.lead_id
                      AND outcome = 'lost' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Repair precondition changed for %', pair.original_id;
    END IF;
    -- Discover all FK dependents, including future additions. Never cascade or
    -- detach a note, checklist, order, meeting, commission or execution.
    FOR fk IN SELECT c.conrelid::regclass AS child_table, a.attname AS child_column
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.confrelid = 'public.pipeline_entries'::regclass AND c.contype = 'f'
    LOOP
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', fk.child_table, fk.child_column)
        INTO dependent_count USING duplicate.id;
      IF dependent_count <> 0 THEN
        RAISE EXCEPTION 'Duplicate % has dependents in %; manual reconciliation needed', duplicate.id, fk.child_table;
      END IF;
    END LOOP;
    INSERT INTO public.lead_history (lead_id, organization_id, action, description, source, entity_type, entity_id, metadata)
    VALUES (original.lead_id, org, 'support_data_repair',
      'Chamado Rafthel: consolidado card duplicado vazio; negócio original preservado e movido para Lead Ruim.',
      'system', 'pipeline_entry', original.id,
      jsonb_build_object('repair_ticket', '52b4f4ca-4ca8-41d9-aaa2-f721e303f22e',
        'original_before', to_jsonb(original), 'duplicate_before', to_jsonb(duplicate),
        'preserved_deal_id', original.deal_id));
    DELETE FROM public.pipeline_entries WHERE id = duplicate.id;
    PERFORM public.mover_negocio(original.id, destination, 'em_andamento', NULL, NULL);
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries WHERE id = original.id
                   AND pipeline_id = destination AND stage_key = 'em_andamento'
                   AND stage_id = '29937b27-28b7-44e5-8551-969a0e5ffb30'::uuid
                   AND deal_id = original.deal_id) THEN
      RAISE EXCEPTION 'Repair postcondition failed for %', original.id;
    END IF;
    repaired := repaired + 1;
  END LOOP;
  RAISE NOTICE 'Rafthel duplicate pairs repaired: %', repaired;
END
$repair$;
COMMIT;
