-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-624 — DEPOIS: asserções do backfill + sondas (guarda de deleção
-- e idempotência) + ENSAIO_OK que ABORTA.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Asserção 1: cobertura do backfill ──────────────────────────────────────
-- Toda org com funil 'whatsapp' ativo ganhou padrão; nenhuma outra ganhou.
DO $$
DECLARE v_esperado bigint; v_preenchido bigint; v_cross bigint; v_inativo bigint;
BEGIN
  SELECT orgs_com_whatsapp INTO v_esperado FROM _e624_antes;
  SELECT count(*) INTO v_preenchido
    FROM public.organizations WHERE default_pipeline_id IS NOT NULL;
  IF v_preenchido <> v_esperado THEN
    RAISE EXCEPTION 'FAIL backfill: % org(s) com padrão, esperado % (= orgs com funil whatsapp ativo).',
      v_preenchido, v_esperado;
  END IF;

  -- Nenhuma org aponta funil de OUTRA org (o predicado do UPDATE junta por
  -- organization_id, mas a asserção não confia — mede).
  SELECT count(*) INTO v_cross
    FROM public.organizations o
    JOIN public.pipelines p ON p.id = o.default_pipeline_id
   WHERE p.organization_id <> o.id;
  IF v_cross > 0 THEN
    RAISE EXCEPTION 'FAIL backfill: % org(s) apontando funil de outra org.', v_cross;
  END IF;

  -- Nenhum padrão aponta funil desativado.
  SELECT count(*) INTO v_inativo
    FROM public.organizations o
    JOIN public.pipelines p ON p.id = o.default_pipeline_id
   WHERE p.is_active = false;
  IF v_inativo > 0 THEN
    RAISE EXCEPTION 'FAIL backfill: % org(s) apontando funil inativo.', v_inativo;
  END IF;

  RAISE NOTICE 'backfill OK: %/% org(s) com padrão, 0 cross-org, 0 inativo.',
    v_preenchido, (SELECT orgs FROM _e624_antes);
END $$;

-- ─── Sonda 1: DELETE de funil apontado tem de morrer com a mensagem boa ─────
-- O EXCEPTION do bloco cria savepoint implícito: a falha esperada não derruba
-- a transação do ensaio.
DO $$
DECLARE v_pipe uuid;
BEGIN
  SELECT default_pipeline_id INTO v_pipe
    FROM public.organizations
   WHERE default_pipeline_id IS NOT NULL
   LIMIT 1;
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'FAIL sonda-delete: nenhuma org com padrão para sondar.';
  END IF;

  BEGIN
    DELETE FROM public.pipelines WHERE id = v_pipe;
    RAISE EXCEPTION 'FAIL sonda-delete: DELETE do funil padrão PASSOU — trg_guard_default_pipeline_delete não segurou.';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL sonda-delete:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'pipeline_is_org_default:%' THEN
        RAISE EXCEPTION 'FAIL sonda-delete: recusou, mas com mensagem inesperada: %', SQLERRM;
      END IF;
      RAISE NOTICE 'sonda-delete OK: DELETE recusado pedindo substituto (%).', SQLERRM;
  END;
END $$;

-- ─── Sonda 2: backfill idempotente (replay afeta 0 linhas) ──────────────────
DO $$
DECLARE v_n bigint;
BEGIN
  UPDATE public.organizations o
  SET default_pipeline_id = p.id
  FROM public.pipelines p
  WHERE p.organization_id = o.id
    AND p.slug = 'whatsapp'
    AND p.is_active IS DISTINCT FROM false
    AND o.default_pipeline_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL idempotência: replay do backfill afetou % linha(s), esperado 0.', v_n;
  END IF;
  RAISE NOTICE 'idempotência OK: replay afetou 0 linhas.';
END $$;

-- ─── ENSAIO_OK: aborta com o placar ─────────────────────────────────────────
DO $$
DECLARE v_orgs bigint; v_com bigint; v_sem bigint;
BEGIN
  SELECT orgs INTO v_orgs FROM _e624_antes;
  SELECT count(*) INTO v_com FROM public.organizations WHERE default_pipeline_id IS NOT NULL;
  v_sem := v_orgs - v_com;
  RAISE EXCEPTION 'ENSAIO_OK SCRUM-624 — coluna + guarda no ar; backfill: %/% org(s) com funil padrão (% sem, ficam "lead sem card").',
    v_com, v_orgs, v_sem;
END $$;

ROLLBACK;
