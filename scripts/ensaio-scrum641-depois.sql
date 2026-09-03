-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-641 — DEPOIS: a migration já rodou (incluindo a org sintética
-- do bloco de verificação dela, criada→verificada→apagada). Aqui: prova de
-- NÃO-MUDANÇA nas orgs existentes + sonda extra de org nova end-to-end +
-- ENSAIO_OK que ABORTA.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Asserção 1: nenhuma org existente mudou ────────────────────────────────
DO $$
DECLARE v _e641_antes%ROWTYPE; v_now bigint;
BEGIN
  SELECT * INTO v FROM _e641_antes;

  SELECT count(*) INTO v_now FROM public.organizations;
  IF v_now <> v.orgs THEN
    RAISE EXCEPTION 'FAIL não-mudança: orgs % → % (org fantasma vazou?).', v.orgs, v_now;
  END IF;

  SELECT count(*) INTO v_now FROM public.pipelines;
  IF v_now <> v.pipelines_total THEN
    RAISE EXCEPTION 'FAIL não-mudança: pipelines % → %.', v.pipelines_total, v_now;
  END IF;

  SELECT count(*) INTO v_now FROM public.pipeline_stages;
  IF v_now <> v.stages_total THEN
    RAISE EXCEPTION 'FAIL não-mudança: pipeline_stages % → %.', v.stages_total, v_now;
  END IF;

  SELECT count(*) INTO v_now FROM public.organizations WHERE default_pipeline_id IS NOT NULL;
  IF v_now <> v.defaults_preenchidos THEN
    RAISE EXCEPTION 'FAIL não-mudança: defaults preenchidos % → %.', v.defaults_preenchidos, v_now;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pipelines WHERE slug = 'vendas') THEN
    RAISE EXCEPTION 'FAIL não-mudança: sobrou funil slug=vendas de org existente/fantasma.';
  END IF;

  RAISE NOTICE 'não-mudança OK: contagens idênticas ao retrato.';
END $$;

-- ─── Sonda: org nova END-TO-END (criada → semeada → verificada → apagada) ───
-- A migration já provou isso no próprio DO block; a sonda repete FORA dele
-- para provar que o trigger sobrevive ao fim da migration (não era efeito
-- colateral da transação interna) e mede o formato exato das etapas.
DO $$
DECLARE
  v_org uuid;
  v_pipe uuid;
  r record;
  v_seq text := '';
BEGIN
  INSERT INTO public.organizations (name, slug)
  VALUES ('__sonda_scrum641__', 'sonda-scrum641-' || left(md5(random()::text), 8))
  RETURNING id INTO v_org;

  SELECT default_pipeline_id INTO v_pipe FROM public.organizations WHERE id = v_org;
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'FAIL sonda: org nova sem default_pipeline_id.';
  END IF;

  FOR r IN
    SELECT stage_key, stage_role::text AS papel, is_final_positive, is_final_negative, requires_sale_value
      FROM public.pipeline_stages
     WHERE pipeline_id = v_pipe
     ORDER BY position
  LOOP
    v_seq := v_seq || format('%s(%s)·', r.stage_key, r.papel);
  END LOOP;

  IF v_seq <> 'novo(open)·em_conversa(open)·reuniao_marcada(meeting_booked)·proposta_enviada(open)·ganhou(won)·perdeu(lost)·' THEN
    RAISE EXCEPTION 'FAIL sonda: trilha semeada divergente: %', v_seq;
  END IF;

  -- Ordem explícita (bug latente: CASCADE de org com etapas morre em
  -- trg_queue_followup_reclassify — ver §3c da migration).
  UPDATE public.organizations SET default_pipeline_id = NULL WHERE id = v_org;
  DELETE FROM public.pipeline_stages WHERE organization_id = v_org;
  DELETE FROM public.followup_reclassify_queue WHERE organization_id = v_org;
  DELETE FROM public.pipelines WHERE organization_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  RAISE NOTICE 'sonda OK: %', v_seq;
END $$;

-- ─── ENSAIO_OK — aborta a transação inteira ────────────────────────────────
DO $$
DECLARE v _e641_antes%ROWTYPE;
BEGIN
  SELECT * INTO v FROM _e641_antes;
  RAISE EXCEPTION 'ENSAIO_OK SCRUM-641 — org nova nasce com o Funil de Vendas (papéis completos) como padrão; % orgs existentes intocadas.', v.orgs;
END $$;

ROLLBACK;
