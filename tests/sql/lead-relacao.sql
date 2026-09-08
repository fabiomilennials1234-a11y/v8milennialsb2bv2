-- Minimal real PostgreSQL fixtures. The runner injects the UNMODIFIED logic of
-- the migration into an isolated schema and rolls the entire transaction back.
CREATE TABLE leads (id uuid PRIMARY KEY, organization_id uuid, primeira_venda_at timestamptz, primeiro_pedido_erp_at timestamptz);
CREATE TABLE sale_events (id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, event_type text, sold_at timestamptz, reversed_event_id uuid);
CREATE TABLE deals (id uuid PRIMARY KEY, organization_id uuid, source_lead_id uuid, outcome text, deleted_at timestamptz);
CREATE TABLE pipelines (id uuid PRIMARY KEY, organization_id uuid, is_active boolean);
CREATE TABLE pipeline_entries (id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, lead_id uuid, deal_id uuid, stage_key text);
CREATE TYPE stage_role AS ENUM ('open','won','lost');
CREATE TABLE pipeline_stages (id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, stage_key text, stage_role stage_role, is_active boolean);

INSERT INTO leads (id, organization_id)
SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
       '00000000-0000-0000-0001-000000000001'::uuid
FROM generate_series(1,15) n;
INSERT INTO leads VALUES ('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0001-000000000002',NULL,NULL);
INSERT INTO deals (id,organization_id,source_lead_id,outcome)
SELECT ('00000000-0000-0000-0002-' || lpad(row_number() over()::text,12,'0'))::uuid,
       l.organization_id,l.id,v.outcome
FROM (VALUES (2,'open'),(3,'lost'),(3,'lost'),(4,'lost'),(4,'open'),
             (5,'won'),(5,'lost'),(6,'lost'),(8,'lost'),(9,'lost'),(11,'lost')) v(n,outcome)
JOIN leads l ON l.id=('00000000-0000-0000-0000-' || lpad(v.n::text,12,'0'))::uuid;
UPDATE deals SET deleted_at=now() WHERE source_lead_id='00000000-0000-0000-0000-000000000011';
UPDATE leads SET primeira_venda_at=now() WHERE id='00000000-0000-0000-0000-000000000006';
UPDATE leads SET primeiro_pedido_erp_at=now() WHERE id='00000000-0000-0000-0000-000000000007';
INSERT INTO sale_events (id,organization_id,lead_id,event_type,sold_at)
SELECT ('00000000-0000-0000-0003-' || lpad(n::text,12,'0'))::uuid,
       l.organization_id,l.id,CASE WHEN n=6 THEN 'sale_lost' ELSE 'sale' END,now()
FROM (VALUES(6),(8),(9)) v(n)
JOIN leads l ON l.id=('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid;
INSERT INTO sale_events VALUES ('00000000-0000-0000-0003-000000000080','00000000-0000-0000-0001-000000000001',
 '00000000-0000-0000-0000-000000000008','sale_reversed',now(),'00000000-0000-0000-0003-000000000008');
-- Deliberately corrupt cross-tenant link: must never classify org 1's lead.
INSERT INTO sale_events VALUES ('00000000-0000-0000-0003-000000000010','00000000-0000-0000-0001-000000000002',
 '00000000-0000-0000-0000-000000000010','sale',now(),NULL);
INSERT INTO pipelines VALUES ('00000000-0000-0000-0004-000000000001','00000000-0000-0000-0001-000000000001',true);
INSERT INTO pipeline_stages VALUES
 ('00000000-0000-0000-0005-000000000001','00000000-0000-0000-0001-000000000001','00000000-0000-0000-0004-000000000001','perdido','lost',true),
 ('00000000-0000-0000-0005-000000000002','00000000-0000-0000-0001-000000000001','00000000-0000-0000-0004-000000000001','vendido','won',true);
INSERT INTO pipeline_entries
SELECT ('00000000-0000-0000-0006-'||lpad(n::text,12,'0'))::uuid,l.organization_id,
 '00000000-0000-0000-0004-000000000001',l.id,NULL,v.stage
FROM (VALUES (12,'perdido'),(13,'vendido'),(14,'unknown'),(15,'00000000-0000-0000-0005-000000000001')) v(n,stage)
JOIN leads l ON l.id=('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;

-- APPLY_MIGRATION

DO $$
DECLARE v record; actual text;
BEGIN
  IF (SELECT count(*) FROM __SCHEMA___backup.lead_first_sale_20260908) <> 2 THEN
    RAISE EXCEPTION 'recovery must back up precisely the stale loss mark and missing win mark, once';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM __SCHEMA___backup.lead_first_sale_20260908
    WHERE lead_id='00000000-0000-0000-0000-000000000006'
      AND previous_value IS NOT NULL AND corrected_value IS NULL) THEN
    RAISE EXCEPTION 'recovery did not preserve the original incorrect mark';
  END IF;
  IF has_table_privilege('anon','__SCHEMA___backup.lead_first_sale_20260908','SELECT')
    OR has_table_privilege('authenticated','__SCHEMA___backup.lead_first_sale_20260908','SELECT') THEN
    RAISE EXCEPTION 'recovery backup exposed to application roles';
  END IF;
  FOR v IN SELECT * FROM (VALUES
    (1,'lead'),(2,'lead'),(3,'perdido'),(4,'lead'),(5,'cliente'),(6,'perdido'),
    (7,'lead'),(8,'perdido'),(9,'cliente'),(10,'lead'),(11,'lead'),
    (12,'perdido'),(13,'cliente'),(14,'lead'),(15,'perdido')
  ) expected(n,relacao) LOOP
    SELECT relacao_negocios(l) INTO actual FROM leads l
    WHERE id=('00000000-0000-0000-0000-'||lpad(v.n::text,12,'0'))::uuid;
    IF actual IS DISTINCT FROM v.relacao THEN
      RAISE EXCEPTION 'case %: expected %, got %',v.n,v.relacao,actual;
    END IF;
  END LOOP;
  PERFORM fn_lead_recalcula_primeira_venda(id) FROM leads;
  IF EXISTS (SELECT 1 FROM leads WHERE primeira_venda_at IS NOT NULL
             AND id <> '00000000-0000-0000-0000-000000000009') THEN
    RAISE EXCEPTION 'loss, reversal or foreign-tenant event became a sale';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id='00000000-0000-0000-0000-000000000009' AND primeira_venda_at IS NOT NULL) THEN
    RAISE EXCEPTION 'legitimate sale lost its first-sale mark';
  END IF;
  IF has_function_privilege('anon','__SCHEMA__.relacao_negocios(__SCHEMA__.leads)','EXECUTE')
    OR NOT has_function_privilege('authenticated','__SCHEMA__.relacao_negocios(__SCHEMA__.leads)','EXECUTE')
    OR NOT has_function_privilege('service_role','__SCHEMA__.relacao_negocios(__SCHEMA__.leads)','EXECUTE')
    OR has_function_privilege('authenticated','__SCHEMA__.fn_lead_recalcula_primeira_venda(uuid)','EXECUTE')
    OR has_function_privilege('anon','__SCHEMA__.fn_lead_recalcula_primeira_venda(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'unexpected EXECUTE permissions';
  END IF;
END $$;

-- Positive + negative isolation assertions under a real non-bypass role.
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['leads','sale_events','deals','pipelines','pipeline_entries','pipeline_stages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT TO authenticated USING (organization_id = current_setting(''test.organization_id'')::uuid)',tbl);
    EXECUTE format('GRANT SELECT ON %I TO authenticated',tbl);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA __SCHEMA__ TO authenticated;
SET LOCAL test.organization_id = '00000000-0000-0000-0001-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM leads) <> 15 THEN RAISE EXCEPTION 'RLS leaked or hid leads'; END IF;
  IF (SELECT relacao_negocios(l) FROM leads l WHERE id='00000000-0000-0000-0000-000000000005') <> 'cliente' THEN
    RAISE EXCEPTION 'authenticated user cannot classify own win';
  END IF;
  IF EXISTS (SELECT 1 FROM leads WHERE id='00000000-0000-0000-0000-000000000099') THEN
    RAISE EXCEPTION 'foreign organization visible';
  END IF;
END $$;
RESET ROLE;
