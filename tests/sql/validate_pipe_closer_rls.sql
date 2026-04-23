-- =============================================================================
-- Teste RLS: Closer B não deve ver lead cujo closer_id foi transferido B → A
-- =============================================================================
-- Simula o bug original completo usando jwt.claims para impersonar cada user.
--   1. Cria org, CloserA, CloserB
--   2. Lead + pipe_propostas com closer_id = CloserA
--   3. Assert: CloserA vê o lead, CloserB não vê (baseline)
--   4. UPDATE leads.closer_id = CloserB, responsible_id = CloserB
--   5. Trigger propaga → pipe_propostas.closer_id = CloserB
--   6. Assert: CloserB vê, CloserA NÃO VÊ MAIS (fix validada via RLS)
--
-- Executado em BEGIN...ROLLBACK — zero persistência.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id UUID;
  v_user_a UUID := gen_random_uuid();
  v_user_b UUID := gen_random_uuid();
  v_user_admin UUID := gen_random_uuid();
  v_tm_a UUID;
  v_tm_b UUID;
  v_tm_admin UUID;
  v_lead_id UUID;
  v_pp_id UUID;
  v_slug TEXT := '__test_rls_' || replace(gen_random_uuid()::text, '-', '');
  v_count_a INT;
  v_count_b INT;
  v_count_admin INT;
BEGIN
  -- ── Setup ─────────────────────────────────────────────────────
  INSERT INTO organizations (name, slug) VALUES ('__test_rls_closer__', v_slug)
    RETURNING id INTO v_org_id;

  SET LOCAL session_replication_role = replica;

  INSERT INTO team_members (organization_id, name, user_id, is_active, role)
    VALUES (v_org_id, 'Closer A', v_user_a, true, 'closer') RETURNING id INTO v_tm_a;
  INSERT INTO team_members (organization_id, name, user_id, is_active, role)
    VALUES (v_org_id, 'Closer B', v_user_b, true, 'closer') RETURNING id INTO v_tm_b;
  INSERT INTO team_members (organization_id, name, user_id, is_active, role)
    VALUES (v_org_id, 'Admin', v_user_admin, true, 'admin') RETURNING id INTO v_tm_admin;

  -- Lead sem SDR (SDR NULL para isolar a visibilidade de closer) + closer = A
  INSERT INTO leads (organization_id, name, phone, sdr_id, closer_id, responsible_id, created_at)
    VALUES (v_org_id, 'Test Lead', '+5511900000001', NULL, v_tm_a, v_tm_a, CURRENT_TIMESTAMP)
    RETURNING id INTO v_lead_id;
  INSERT INTO pipe_propostas (organization_id, lead_id, status, sale_value, closer_id, responsible_id, created_at)
    VALUES (v_org_id, v_lead_id, 'proposta_enviada', 1000, v_tm_a, v_tm_a, CURRENT_TIMESTAMP)
    RETURNING id INTO v_pp_id;

  SET LOCAL session_replication_role = origin;

  -- ── Baseline: A vê, B não vê ──────────────────────────────────
  SET LOCAL role = 'authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_count_a FROM pipe_propostas WHERE id = v_pp_id;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_count_b FROM pipe_propostas WHERE id = v_pp_id;

  RESET role;
  RAISE NOTICE '=== BASELINE (closer A é o dono) ===';
  RAISE NOTICE '  Closer A vê:   % (esperado: 1)', v_count_a;
  RAISE NOTICE '  Closer B vê:   % (esperado: 0)', v_count_b;

  ASSERT v_count_a = 1, 'BASELINE FAIL: Closer A deveria ver o próprio lead';
  ASSERT v_count_b = 0, 'BASELINE FAIL: Closer B NÃO deveria ver lead de A';

  -- ── ACT: transfere para B ─────────────────────────────────────
  UPDATE leads
    SET closer_id = v_tm_b, responsible_id = v_tm_b
    WHERE id = v_lead_id;

  -- Verificar trigger propagou
  DECLARE v_pp_closer UUID; v_pp_responsible UUID;
  BEGIN
    SELECT closer_id, responsible_id INTO v_pp_closer, v_pp_responsible
      FROM pipe_propostas WHERE id = v_pp_id;
    RAISE NOTICE '=== APÓS TRANSFERÊNCIA ===';
    RAISE NOTICE '  pipe_propostas.closer_id      = % (esperado: % — Closer B)', v_pp_closer, v_tm_b;
    RAISE NOTICE '  pipe_propostas.responsible_id = % (esperado: % — Closer B)', v_pp_responsible, v_tm_b;
    ASSERT v_pp_closer = v_tm_b, 'Trigger não propagou closer_id';
    ASSERT v_pp_responsible = v_tm_b, 'Trigger não propagou responsible_id';
  END;

  -- ── ASSERT RLS: A não vê mais, B vê agora ─────────────────────
  SET LOCAL role = 'authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_count_a FROM pipe_propostas WHERE id = v_pp_id;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_count_b FROM pipe_propostas WHERE id = v_pp_id;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_admin::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_count_admin FROM pipe_propostas WHERE id = v_pp_id;

  RESET role;
  RAISE NOTICE '=== VISIBILIDADE RLS PÓS-TRANSFERÊNCIA ===';
  RAISE NOTICE '  Closer A vê:   % (esperado: 0 — NÃO pode mais ver)', v_count_a;
  RAISE NOTICE '  Closer B vê:   % (esperado: 1 — novo dono)', v_count_b;
  RAISE NOTICE '  Admin vê:      % (esperado: 1 — admin vê tudo)', v_count_admin;

  ASSERT v_count_a = 0, FORMAT('BUG REGRESSO: Closer A ainda vê lead após transferência! got %s', v_count_a);
  ASSERT v_count_b = 1, FORMAT('Closer B não vê próprio lead após transferência. got %s', v_count_b);
  ASSERT v_count_admin = 1, FORMAT('Admin não vê lead (regressão). got %s', v_count_admin);

  RAISE NOTICE '=== PASSOU: RLS respeita transferência de closer ===';
END $$;

ROLLBACK;
