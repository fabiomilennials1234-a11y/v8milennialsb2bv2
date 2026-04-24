-- =============================================================================
-- Prova que o fix 20260417110000 realmente resolve o bug de closer residual
-- =============================================================================
-- Reproduz o cenário:
--   1. Lead com closer_id = CloserA, entrada em pipe_propostas com closer_id = CloserA
--   2. UPDATE leads SET closer_id = CloserB
--   3. Assert: pipe_propostas.closer_id agora é CloserB (antes do fix: permanecia CloserA)
--
-- Também valida sincronização de sdr_id e responsible_id.
-- Tudo em transação com ROLLBACK — zero persistência.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id UUID;
  v_user_a UUID := gen_random_uuid();
  v_user_b UUID := gen_random_uuid();
  v_closer_a UUID;
  v_closer_b UUID;
  v_lead_id UUID;
  v_pp_id UUID;
  v_pc_id UUID;
  v_pw_id UUID;
  v_pp_closer UUID;
  v_pp_responsible UUID;
  v_pc_closer UUID;
  v_pc_sdr UUID;
  v_pw_sdr UUID;
  v_slug TEXT := '__test_pipe_sync_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO organizations (name, slug) VALUES ('__test_pipe_sync__', v_slug)
  RETURNING id INTO v_org_id;

  SET LOCAL session_replication_role = replica;

  INSERT INTO team_members (organization_id, name, user_id, is_active, role)
  VALUES (v_org_id, 'Closer A', v_user_a, true, 'closer') RETURNING id INTO v_closer_a;

  INSERT INTO team_members (organization_id, name, user_id, is_active, role)
  VALUES (v_org_id, 'Closer B', v_user_b, true, 'closer') RETURNING id INTO v_closer_b;

  -- Lead inicial: closer_id = A
  INSERT INTO leads (organization_id, name, phone, sdr_id, closer_id, responsible_id, created_at)
  VALUES (v_org_id, 'Test Lead', '+5511900000001', v_closer_a, v_closer_a, v_closer_a, CURRENT_TIMESTAMP)
  RETURNING id INTO v_lead_id;

  INSERT INTO pipe_propostas (organization_id, lead_id, status, sale_value, product_type, closer_id, responsible_id, created_at)
  VALUES (v_org_id, v_lead_id, 'proposta_enviada', 1000, 'mrr', v_closer_a, v_closer_a, CURRENT_TIMESTAMP)
  RETURNING id INTO v_pp_id;

  INSERT INTO pipe_confirmacao (organization_id, lead_id, status, sdr_id, closer_id, responsible_id, created_at)
  VALUES (v_org_id, v_lead_id, 'compromisso_marcado', v_closer_a, v_closer_a, v_closer_a, CURRENT_TIMESTAMP)
  RETURNING id INTO v_pc_id;

  INSERT INTO pipe_whatsapp (organization_id, lead_id, status, sdr_id, responsible_id, created_at)
  VALUES (v_org_id, v_lead_id, 'novo_lead', v_closer_a, v_closer_a, CURRENT_TIMESTAMP)
  RETURNING id INTO v_pw_id;

  -- volta pros triggers ligados (precisamos do trigger de sync!)
  SET LOCAL session_replication_role = origin;

  -- ═══ ACT: transfere tudo para Closer B (lead.closer_id, sdr_id, responsible_id) ═══
  UPDATE leads
  SET closer_id = v_closer_b, sdr_id = v_closer_b, responsible_id = v_closer_b
  WHERE id = v_lead_id;

  -- ═══ ASSERT: todos os pipes foram atualizados pelo trigger ═══
  SELECT closer_id, responsible_id INTO v_pp_closer, v_pp_responsible
    FROM pipe_propostas WHERE id = v_pp_id;
  SELECT closer_id, sdr_id INTO v_pc_closer, v_pc_sdr
    FROM pipe_confirmacao WHERE id = v_pc_id;
  SELECT sdr_id INTO v_pw_sdr
    FROM pipe_whatsapp WHERE id = v_pw_id;

  RAISE NOTICE '=== EVIDÊNCIA ===';
  RAISE NOTICE 'Cenário: lead transferido de Closer A (%) para Closer B (%)', v_closer_a, v_closer_b;
  RAISE NOTICE '  pipe_propostas.closer_id       = % (esperado: % — Closer B)', v_pp_closer, v_closer_b;
  RAISE NOTICE '  pipe_propostas.responsible_id  = % (esperado: % — Closer B)', v_pp_responsible, v_closer_b;
  RAISE NOTICE '  pipe_confirmacao.closer_id     = % (esperado: % — Closer B)', v_pc_closer, v_closer_b;
  RAISE NOTICE '  pipe_confirmacao.sdr_id        = % (esperado: % — Closer B)', v_pc_sdr, v_closer_b;
  RAISE NOTICE '  pipe_whatsapp.sdr_id           = % (esperado: % — Closer B)', v_pw_sdr, v_closer_b;

  ASSERT v_pp_closer = v_closer_b, FORMAT('pipe_propostas.closer_id NÃO foi sincronizado. got %s, expected %s', v_pp_closer, v_closer_b);
  ASSERT v_pp_responsible = v_closer_b, 'pipe_propostas.responsible_id NÃO foi sincronizado';
  ASSERT v_pc_closer = v_closer_b, 'pipe_confirmacao.closer_id NÃO foi sincronizado';
  ASSERT v_pc_sdr = v_closer_b, 'pipe_confirmacao.sdr_id NÃO foi sincronizado';
  ASSERT v_pw_sdr = v_closer_b, 'pipe_whatsapp.sdr_id NÃO foi sincronizado';

  RAISE NOTICE '=== PASSOU: fix do trigger propaga closer_id + sdr_id + responsible_id ===';
END $$;

ROLLBACK;
