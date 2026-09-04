-- DEPOIS — asserções. Prova quem PODE e, principalmente, quem NÃO pode.

DO $$
DECLARE
  v_org    uuid := (SELECT valor::uuid FROM _os WHERE chave='org');
  v_admin  uuid := (SELECT valor::uuid FROM _os WHERE chave='admin');
  v_membro uuid := (SELECT valor::uuid FROM _os WHERE chave='membro');
  v_outra  uuid := (SELECT valor::uuid FROM _os WHERE chave='funil_de_outra_org');
  v_pipe   uuid;
  v_r      jsonb;
  v_falhas text := '';
BEGIN
  SELECT id INTO v_pipe FROM public.pipelines WHERE organization_id=v_org AND is_active LIMIT 1;

  PERFORM set_config('role','authenticated', true);

  -- ── 1. ADMIN PODE ────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  BEGIN
    v_r := public.set_org_settings(v_org, jsonb_build_object('confirmacao_overdue_days', 7));
    IF (SELECT confirmacao_overdue_days FROM public.organizations WHERE id=v_org) <> 7 THEN
      v_falhas := v_falhas || E'\n  admin escreveu mas o valor não mudou';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || format(E'\n  admin FOI BARRADO (era para poder): [%s] %s', SQLSTATE, SQLERRM);
  END;

  -- funil padrão da própria org
  BEGIN
    v_r := public.set_org_settings(v_org, jsonb_build_object('default_pipeline_id', v_pipe::text));
    IF (SELECT default_pipeline_id FROM public.organizations WHERE id=v_org) IS DISTINCT FROM v_pipe THEN
      v_falhas := v_falhas || E'\n  funil padrão não gravou';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || format(E'\n  admin barrado no funil padrão: [%s] %s', SQLSTATE, SQLERRM);
  END;

  -- ── 2. MEMBRO COMUM NÃO PODE ─────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_membro::text,'role','authenticated')::text, true);
  BEGIN
    v_r := public.set_org_settings(v_org, jsonb_build_object('confirmacao_overdue_days', 99));
    v_falhas := v_falhas || E'\n  MEMBRO COMUM CONSEGUIU ESCREVER — furo de autorização';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      v_falhas := v_falhas || format(E'\n  membro recusado pelo motivo errado: [%s] %s', SQLSTATE, SQLERRM);
    END IF;
  END;

  -- ── 3. CHAVE FORA DA ALLOWLIST É RECUSADA, NÃO IGNORADA ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  BEGIN
    v_r := public.set_org_settings(v_org, jsonb_build_object('subscription_plan','enterprise'));
    v_falhas := v_falhas || E'\n  ESCALAÇÃO: admin mudou subscription_plan pela RPC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      v_falhas := v_falhas || format(E'\n  chave intrusa recusada pelo motivo errado: [%s] %s', SQLSTATE, SQLERRM);
    END IF;
  END;
  -- e o plano não pode ter mudado
  IF (SELECT subscription_plan FROM public.organizations WHERE id=v_org) = 'enterprise' THEN
    v_falhas := v_falhas || E'\n  ESCALAÇÃO CONFIRMADA: subscription_plan foi alterado';
  END IF;

  -- ── 4. FUNIL DE OUTRA ORG É RECUSADO ─────────────────────────────────────
  IF v_outra IS NOT NULL THEN
    BEGIN
      v_r := public.set_org_settings(v_org, jsonb_build_object('default_pipeline_id', v_outra::text));
      v_falhas := v_falhas || E'\n  CROSS-TENANT: aceitou funil de outra organização como padrão';
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE <> '42501' THEN
        v_falhas := v_falhas || format(E'\n  cross-org recusado pelo motivo errado: [%s] %s', SQLSTATE, SQLERRM);
      END IF;
    END;
  END IF;

  -- ── 5. FAIXA VALIDADA NO SERVIDOR ────────────────────────────────────────
  BEGIN
    v_r := public.set_org_settings(v_org, jsonb_build_object('confirmacao_overdue_days', 9999));
    v_falhas := v_falhas || E'\n  aceitou 9999 dias — limite só existe no cliente';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '22023' THEN
      v_falhas := v_falhas || format(E'\n  faixa recusada pelo motivo errado: [%s] %s', SQLSTATE, SQLERRM);
    END IF;
  END;

  -- ── 6. anon NÃO executa ──────────────────────────────────────────────────
  PERFORM set_config('role','postgres', true);
  IF has_function_privilege('anon','public.set_org_settings(uuid, jsonb)','EXECUTE') THEN
    v_falhas := v_falhas || E'\n  anon pode executar — função nova nasce executável e o REVOKE não pegou';
  END IF;
  IF NOT has_function_privilege('authenticated','public.set_org_settings(uuid, jsonb)','EXECUTE') THEN
    v_falhas := v_falhas || E'\n  authenticated NÃO pode executar — o front quebraria';
  END IF;

  -- ── 7. a tabela CONTINUA fechada ─────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.organizations'::regclass
               AND polcmd IN ('w','*') AND polname NOT LIKE 'master%') THEN
    v_falhas := v_falhas || E'\n  apareceu policy de UPDATE não-master em organizations — a tabela tinha que seguir fechada';
  END IF;

  IF v_falhas <> '' THEN
    RAISE EXCEPTION 'ENSAIO REPROVOU:%', v_falhas;
  END IF;

  RAISE EXCEPTION 'ENSAIO_OK org-settings — admin pode, membro não, chave intrusa recusada, cross-org recusado, faixa validada, anon fora, tabela fechada. Abortando; nada gravado.';
END $$;

ROLLBACK;
