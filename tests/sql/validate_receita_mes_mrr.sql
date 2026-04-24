-- =============================================================================
-- Validação: "receita do mês" não infla com contract_duration para MRR
-- =============================================================================
-- Objetivo: provar que após 20260417100000_fix_receita_mes_mrr_contract_duration.sql,
-- uma venda MRR de sale_value=1000 com contract_duration=12 devolve vendaTotal=1000
-- (não 12000 como era o bug).
--
-- Estratégia: usar uma org isolada (criada com slug UUID aleatório) + pegar um
-- closer existente dessa org OU reciclar um user_id aleatório. team_members
-- tem trigger de quota de seats — contornamos inserindo direto com UUID sintético
-- e desabilitando o trigger pela duração da transação (super-user only). Tudo em
-- uma transação com ROLLBACK final — zero persistência.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id UUID;
  v_user_id UUID := gen_random_uuid();
  v_member_id UUID;
  v_lead_mrr_id UUID;
  v_lead_projeto_id UUID;
  v_start DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  v_end DATE := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  v_result JSONB;
  v_venda_total NUMERIC;
  v_venda_mrr NUMERIC;
  v_venda_projeto NUMERIC;
  v_ticket NUMERIC;
  v_funnel_vendas INT;
  v_slug TEXT := '__test_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  -- Org isolada
  INSERT INTO organizations (name, slug) VALUES ('__test_receita_mes__', v_slug)
  RETURNING id INTO v_org_id;

  -- Bypass todos os triggers da org (quota de seats, validação de stages, etc.)
  -- Só funciona com super-user (postgres). Não persiste fora da transação.
  SET LOCAL session_replication_role = replica;

  INSERT INTO team_members (organization_id, name, user_id, is_active, role)
  VALUES (v_org_id, 'Test Closer', v_user_id, true, 'closer')
  RETURNING id INTO v_member_id;

  -- Lead + proposta MRR: sale_value=1000, duration=12
  -- Antes do fix: vendaTotal += 1000×12 = 12000 (BUG)
  -- Depois do fix: vendaTotal += 1000 (correto)
  INSERT INTO leads (organization_id, name, phone, created_at)
  VALUES (v_org_id, 'Lead MRR', '+5511999999001', CURRENT_TIMESTAMP)
  RETURNING id INTO v_lead_mrr_id;

  INSERT INTO pipe_propostas (
    organization_id, lead_id, status,
    sale_value, product_type, contract_duration,
    closer_id, closed_at, created_at
  )
  VALUES (
    v_org_id, v_lead_mrr_id, 'vendido',
    1000, 'mrr', 12,
    v_member_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

  -- Lead + proposta Projeto: sale_value=5000
  INSERT INTO leads (organization_id, name, phone, created_at)
  VALUES (v_org_id, 'Lead Projeto', '+5511999999002', CURRENT_TIMESTAMP)
  RETURNING id INTO v_lead_projeto_id;

  INSERT INTO pipe_propostas (
    organization_id, lead_id, status,
    sale_value, product_type, contract_duration,
    closer_id, closed_at, created_at
  )
  VALUES (
    v_org_id, v_lead_projeto_id, 'vendido',
    5000, 'projeto', NULL,
    v_member_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

  -- Call RPC
  v_result := get_dashboard_metrics(v_org_id, v_start, v_end, NULL);

  v_venda_total := (v_result->>'vendaTotal')::NUMERIC;
  v_venda_mrr := (v_result->>'vendaMRR')::NUMERIC;
  v_venda_projeto := (v_result->>'vendaProjeto')::NUMERIC;
  v_ticket := (v_result->>'ticketMedio')::NUMERIC;
  v_funnel_vendas := (v_result->>'funnelVendas')::INT;

  RAISE NOTICE '=== EVIDÊNCIA ===';
  RAISE NOTICE 'Fixtures: 1x MRR (R$ 1000/mês × 12 meses) + 1x Projeto (R$ 5000)';
  RAISE NOTICE '  funnelVendas  = % (esperado: 2)', v_funnel_vendas;
  RAISE NOTICE '  vendaMRR      = % (esperado: 1000, monthly recurring)', v_venda_mrr;
  RAISE NOTICE '  vendaProjeto  = % (esperado: 5000)', v_venda_projeto;
  RAISE NOTICE '  vendaTotal    = % (esperado: 6000 = 1000 + 5000, SEM x12)', v_venda_total;
  RAISE NOTICE '  ticketMedio   = % (esperado: 3000 = 6000/2)', v_ticket;

  ASSERT v_funnel_vendas = 2, 'funnelVendas deveria ser 2';
  ASSERT v_venda_mrr = 1000, 'vendaMRR deveria ser 1000 (mensal), got ' || v_venda_mrr;
  ASSERT v_venda_projeto = 5000, 'vendaProjeto deveria ser 5000, got ' || v_venda_projeto;
  ASSERT v_venda_total = 6000,
    FORMAT('vendaTotal deveria ser 6000 (sem inflar por contract_duration), got %s. ' ||
           'Se veio 17000 ou 12000+, a multiplicação por contract_duration ainda está ativa (bug).',
           v_venda_total);
  ASSERT v_ticket = 3000, 'ticketMedio deveria ser 3000, got ' || v_ticket;

  RAISE NOTICE '=== PASSOU: fix aplicada corretamente ===';
END $$;

ROLLBACK;
