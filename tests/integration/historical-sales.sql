-- Executar no banco isolado de tests/fixtures/historical-sales-schema.sql.
-- Usa schemas/constraints e funções de receita/ciclo capturados de produção,
-- com identidades sintéticas e helpers de autorização reduzidos ao contrato.
BEGIN;
INSERT INTO organizations(id) VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000010');
INSERT INTO team_members(id,user_id,organization_id) VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
INSERT INTO leads(id,organization_id,name) VALUES
('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000001','Histórico'),
('00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000002','Outra organização');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
SET LOCAL ROLE authenticated;

SELECT registrar_vendas_historicas('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000001000',
 '[{"value":200,"date":"2025-03-02"},{"value":100,"date":"2025-01-01"},{"value":150,"date":"2025-01-31"}]');
-- Mesma lista/chave: nenhum segundo lançamento.
SELECT registrar_vendas_historicas('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000001000',
 '[{"value":200,"date":"2025-03-02"},{"value":100,"date":"2025-01-01"},{"value":150,"date":"2025-01-31"}]');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM deals) = 3, 'negócios duplicados';
  ASSERT (SELECT count(*) FROM deals WHERE won AND outcome='won') = 3, 'não ganhou';
  ASSERT (SELECT count(*) FROM pipeline_entries) = 0, 'criou card em funil';
  ASSERT (SELECT count(*) FROM sale_events) = 3, 'receita duplicada com trigger habilitado';
  ASSERT (SELECT sum(sale_value) FROM sale_events) = 450, 'valor incorreto';
  ASSERT (SELECT count(*) FROM upsell_orders) = 3, 'faltou pedido';
  ASSERT (SELECT reorder_cycle_days FROM upsell_clients LIMIT 1) = 30, 'ciclo incorreto';
  ASSERT (SELECT order_count FROM upsell_clients LIMIT 1) = 3, 'contagem incorreta';
  ASSERT (SELECT first_sale_at::date FROM upsell_clients LIMIT 1) = '2025-01-01'::date, 'primeira venda incorreta';
  ASSERT (SELECT count(*) FROM sale_events WHERE revenue_stream='novo_negocio') = 1, 'aquisição duplicada';
  ASSERT (SELECT count(*) FROM sale_events WHERE deal_id IS NOT NULL AND sold_at < '2026-01-01') = 3, 'data histórica perdida';
  ASSERT NOT has_function_privilege('anon','registrar_vendas_historicas(uuid,uuid,jsonb)','EXECUTE'), 'anon exposto';
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM registrar_vendas_historicas('00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000001001','[{"value":1,"date":"2025-01-01"}]');
    RAISE EXCEPTION 'cross-org foi permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM registrar_vendas_historicas('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000001000','[{"value":999,"date":"2025-01-01"}]');
    RAISE EXCEPTION 'idempotência aceitou alteração';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM registrar_vendas_historicas('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000001002','[{"value":10,"date":"2025-01-01"},{"value":0,"date":"2025-02-01"}]');
    RAISE EXCEPTION 'venda inválida permitida';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM registrar_vendas_historicas('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000001003','[{"value":10,"date":"2999-01-01"}]');
    RAISE EXCEPTION 'data futura permitida';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT (SELECT count(*) FROM deals) = 3, 'gravação parcial';
END $$;
RESET ROLE;
-- Uma venda vinculada não pode ser alterada pela edição genérica de pedido,
-- que não corrige o evento de receita nem o negócio.
DO $$ BEGIN
  BEGIN
    UPDATE upsell_orders SET sale_value = 999;
    RAISE EXCEPTION 'histórico editável por pedido';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE organizations SET carteira_emits_revenue_enabled=false;
SET LOCAL ROLE authenticated;
SELECT registrar_vendas_historicas('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000001004','[{"value":50,"date":"2025-04-01"}]');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM sale_events) = 4, 'receita perdida com flag desligada';
  ASSERT (SELECT sum(sale_value) FROM sale_events) = 500, 'total incorreto';
END $$;
ROLLBACK;
