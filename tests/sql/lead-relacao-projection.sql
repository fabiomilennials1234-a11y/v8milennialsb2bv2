-- APPLY_PROJECTION
UPDATE leads l SET relacao_negocios=__SCHEMA__.relacao_negocios(l);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM leads l WHERE l.relacao_negocios IS DISTINCT FROM __SCHEMA__.relacao_negocios(l)) THEN
    RAISE EXCEPTION 'backfill differs from canonical calculation';
  END IF;
END $$;
-- Reassignment updates both people; deleting the win restores lost.
INSERT INTO deals VALUES('00000000-0000-0000-0002-000000000100','00000000-0000-0000-0001-000000000001','00000000-0000-0000-0000-000000000003','won',NULL);
DO $$ BEGIN
 IF (SELECT relacao_negocios FROM leads WHERE id='00000000-0000-0000-0000-000000000003') <> 'cliente' THEN RAISE EXCEPTION 'new win did not update'; END IF;
END $$;
UPDATE deals SET source_lead_id='00000000-0000-0000-0000-000000000002' WHERE id='00000000-0000-0000-0002-000000000100';
DO $$ BEGIN
 IF (SELECT relacao_negocios FROM leads WHERE id='00000000-0000-0000-0000-000000000003') <> 'perdido' THEN RAISE EXCEPTION 'old source stale'; END IF;
 IF (SELECT relacao_negocios FROM leads WHERE id='00000000-0000-0000-0000-000000000002') <> 'cliente' THEN RAISE EXCEPTION 'new source stale'; END IF;
END $$;
DELETE FROM deals WHERE id='00000000-0000-0000-0002-000000000100';
UPDATE deals SET outcome='lost' WHERE source_lead_id='00000000-0000-0000-0000-000000000002';
UPDATE pipelines SET is_active=false;
UPDATE pipelines SET is_active=true;
UPDATE pipeline_stages SET stage_role='open' WHERE stage_key='perdido';
DELETE FROM pipeline_entries WHERE lead_id='00000000-0000-0000-0000-000000000013';
DELETE FROM sale_events WHERE reversed_event_id IS NOT NULL;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM leads l WHERE l.relacao_negocios IS DISTINCT FROM __SCHEMA__.relacao_negocios(l)) THEN RAISE EXCEPTION 'projection drift after mutations'; END IF;
 IF has_function_privilege('authenticated','__SCHEMA__.refresh_lead_relacao(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','__SCHEMA__.refresh_lead_relacao(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'refresh exposed'; END IF;
END $$;
-- An authenticated writer cannot forge the projection or access another tenant.
CREATE POLICY tenant_update ON leads FOR UPDATE TO authenticated
 USING (organization_id=current_setting('test.organization_id')::uuid)
 WITH CHECK (organization_id=current_setting('test.organization_id')::uuid);
GRANT UPDATE ON leads TO authenticated;
SET LOCAL ROLE authenticated;
UPDATE leads SET relacao_negocios='cliente' WHERE id='00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
 IF (SELECT relacao_negocios FROM leads WHERE id='00000000-0000-0000-0000-000000000003') <> 'perdido' THEN RAISE EXCEPTION 'client forged relation'; END IF;
 IF EXISTS(SELECT 1 FROM leads WHERE organization_id <> current_setting('test.organization_id')::uuid) THEN RAISE EXCEPTION 'projection leaked tenant'; END IF;
END $$;
RESET ROLE;
