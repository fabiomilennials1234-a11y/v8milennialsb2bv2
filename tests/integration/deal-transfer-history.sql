BEGIN;
CREATE FUNCTION qa_id(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5($1)::uuid $$;
INSERT INTO pipelines VALUES
 (qa_id('source'),qa_id('org'),'custom','Vendas'),(qa_id('target'),qa_id('org'),'custom','Pós-venda'),(qa_id('foreign'),qa_id('foreign-org'),'custom','Outra empresa');
INSERT INTO pipeline_stages VALUES
 (qa_id('s-open'),qa_id('org'),qa_id('source'),'open','Negociação','open'),
 (qa_id('s-won'),qa_id('org'),qa_id('source'),'won','Venda ganha','won'),
 (qa_id('t-open'),qa_id('org'),qa_id('target'),'open','Implantação','open'),
 (qa_id('t-won'),qa_id('org'),qa_id('target'),'won','Concluído','won'),
 (qa_id('f-open'),qa_id('foreign-org'),qa_id('foreign'),'open','Aberto','open');
INSERT INTO team_members VALUES(qa_id('user'),qa_id('org'),'Vendedor');
INSERT INTO deals VALUES(qa_id('deal'),'open',null,null),(qa_id('other-deal'),'open',null,null);
SELECT set_config('test.uid',qa_id('user')::text,true),set_config('test.org',qa_id('org')::text,true);
INSERT INTO pipeline_entries(id,organization_id,lead_id,pipeline_id,stage_key,deal_id) VALUES
 (qa_id('entry'),qa_id('org'),qa_id('lead'),qa_id('source'),'open',qa_id('deal')),
 (qa_id('other-entry'),qa_id('org'),qa_id('lead'),qa_id('target'),'open',qa_id('other-deal'));
SET LOCAL ROLE authenticated;
SELECT mover_negocio(qa_id('entry'),qa_id('target'),qa_id('t-open')::text,'won');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM pipeline_entries) <> 2 THEN RAISE EXCEPTION 'duplicated entry'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pipeline_entries WHERE id=qa_id('entry') AND pipeline_id=qa_id('target') AND deal_id=qa_id('deal')) THEN RAISE EXCEPTION 'identity not preserved'; END IF;
 IF (SELECT outcome FROM deals WHERE id=qa_id('deal')) <> 'won' THEN RAISE EXCEPTION 'transfer reversed the won sale'; END IF;
 IF (SELECT outcome FROM deals WHERE id=qa_id('other-deal')) <> 'open' THEN RAISE EXCEPTION 'touched unrelated sale'; END IF;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM pipeline_stage_events WHERE entry_id=qa_id('entry')) <> 3 THEN RAISE EXCEPTION 'missing step in route'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pipeline_stage_events WHERE entry_id=qa_id('entry') AND from_pipeline_name='Vendas' AND to_pipeline_name='Pós-venda' AND from_stage_name='Venda ganha' AND to_stage_name='Implantação' AND actor_name='Vendedor') THEN RAISE EXCEPTION 'incomplete history'; END IF;
END $$;
-- Retry must not produce another closure or history item.
SELECT mover_negocio(qa_id('entry'),qa_id('target'),qa_id('t-open')::text,'won');
DO $$ BEGIN IF (SELECT count(*) FROM pipeline_stage_events WHERE entry_id=qa_id('entry')) <> 3 THEN RAISE EXCEPTION 'retry duplicated events'; END IF; END $$;
-- Same stage key, different funnel still records a move.
SELECT mover_negocio(qa_id('other-entry'),qa_id('source'),'open');
DO $$ BEGIN IF (SELECT count(*) FROM pipeline_stage_events WHERE entry_id=qa_id('other-entry')) <> 2 THEN RAISE EXCEPTION 'same-key transfer lost'; END IF; END $$;
UPDATE pipelines SET name='Renomeado' WHERE id=qa_id('source');
UPDATE pipeline_stages SET name='Renomeada' WHERE id=qa_id('s-won');
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pipeline_stage_events WHERE from_pipeline_name='Vendas' AND from_stage_name='Venda ganha') THEN RAISE EXCEPTION 'snapshots lost'; END IF; END $$;
-- All failures must leave the entry and its history intact.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM mover_negocio(qa_id('entry'),qa_id('foreign'),'open'); RAISE EXCEPTION 'cross-tenant move allowed'; EXCEPTION WHEN no_data_found OR check_violation THEN NULL; END;
 BEGIN PERFORM mover_negocio(qa_id('entry'),qa_id('source'),'missing','won'); RAISE EXCEPTION 'invalid stage allowed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('test.org',qa_id('foreign-org')::text,true);
DO $$ BEGIN BEGIN PERFORM mover_negocio(qa_id('entry'),qa_id('foreign'),'open'); RAISE EXCEPTION 'foreign entry allowed'; EXCEPTION WHEN no_data_found THEN NULL; END; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM pipeline_stage_events WHERE entry_id=qa_id('entry')) <> 3 THEN RAISE EXCEPTION 'failed transaction modified history'; END IF;
 IF has_function_privilege('anon','mover_negocio(uuid,uuid,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon may move'; END IF;
 IF has_function_privilege('authenticated','fn_capture_pipeline_stage_event()','EXECUTE') THEN RAISE EXCEPTION 'client may forge history'; END IF;
END $$;
-- Entry without a deals row also registers just one sale.
UPDATE pipeline_stages SET stage_role=NULL WHERE id=qa_id('t-open');
INSERT INTO pipeline_entries(id,organization_id,lead_id,pipeline_id,stage_key) VALUES
 (qa_id('legacy'),qa_id('org'),qa_id('lead'),qa_id('source'),'open');
SELECT mover_negocio(qa_id('legacy'),qa_id('target'),'open','won');
DO $$ BEGIN IF (SELECT count(*) FROM legacy_sales WHERE outcome='won') <> 1 OR EXISTS(SELECT 1 FROM legacy_sales WHERE outcome='open') THEN RAISE EXCEPTION 'legacy sale duplicated or reversed'; END IF; END $$;
-- A deliberate won -> open change inside one funnel still reopens.
UPDATE pipeline_entries SET stage_key='won' WHERE id=qa_id('entry');
UPDATE pipeline_entries SET stage_key='open' WHERE id=qa_id('entry');
DO $$ BEGIN IF (SELECT outcome FROM deals WHERE id=qa_id('deal')) <> 'open' THEN RAISE EXCEPTION 'same-funnel reopening broken'; END IF; END $$;
ROLLBACK;
