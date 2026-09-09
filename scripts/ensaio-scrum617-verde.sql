-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-617 — VERDE: asserções extras pós-migrations (além dos DO blocks
-- que as próprias migrations carregam) + sondas de escrita pelos caminhos
-- REAIS: INSTEAD OF da view pipe_whatsapp e sync de custom_pipe_entries.
-- (A migration já sonda o espelho nos dois sentidos com escrita direta.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Cobertura bate com a medição independente do ANTES (emulada pré-616) ──
DO $$
DECLARE c record; v_com bigint; v_orfas bigint;
BEGIN
  SELECT * INTO c FROM _e617_counts;
  SELECT count(*) FILTER (WHERE stage_id IS NOT NULL),
         count(*) FILTER (WHERE stage_id IS NULL)
    INTO v_com, v_orfas
  FROM public.pipeline_entries;

  IF v_com <> c.resolviveis + c.recuperaveis_uuid THEN
    RAISE EXCEPTION 'VERDE FALHOU: % com stage_id, esperado % (% resolvíveis + % uuid) — a resolução pós-616 divergiu da emulação pré-616',
      v_com, c.resolviveis + c.recuperaveis_uuid, c.resolviveis, c.recuperaveis_uuid;
  END IF;
  IF v_orfas <> c.orfas THEN
    RAISE EXCEPTION 'VERDE FALHOU: % órfãs, esperado %', v_orfas, c.orfas;
  END IF;
  RAISE NOTICE 'verde: cobertura OK (% com stage_id, % órfãs)', v_com, v_orfas;
END $$;

-- ─── Identidade preservada: nenhum entry sumiu ou nasceu ───────────────────
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM (
    SELECT id FROM _e617_pre
    EXCEPT
    SELECT id FROM public.pipeline_entries
  ) d;
  IF v <> 0 OR (SELECT count(*) FROM public.pipeline_entries) <> (SELECT count(*) FROM _e617_pre) THEN
    RAISE EXCEPTION 'VERDE FALHOU: conjunto de entries mudou (% ids sumiram)', v;
  END IF;
  RAISE NOTICE 'verde: identidade dos entries OK';
END $$;

-- ─── stage_key só mudou nos reparos uuid-key (D-c) ─────────────────────────
DO $$
DECLARE c record; v_diff bigint; v_diff_nao_uuid bigint;
BEGIN
  SELECT * INTO c FROM _e617_counts;
  SELECT count(*),
         count(*) FILTER (WHERE p.stage_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    INTO v_diff, v_diff_nao_uuid
  FROM _e617_pre p
  JOIN public.pipeline_entries pe ON pe.id = p.id
  WHERE pe.stage_key IS DISTINCT FROM p.stage_key;
  IF v_diff <> c.recuperaveis_uuid OR v_diff_nao_uuid <> 0 THEN
    RAISE EXCEPTION 'VERDE FALHOU: % stage_keys mudaram (% fora do reparo uuid) — esperado exatamente % reparos',
      v_diff, v_diff_nao_uuid, c.recuperaveis_uuid;
  END IF;
  RAISE NOTICE 'verde: stage_key só mudou nos % reparos uuid-key', v_diff;
END $$;

-- ─── Sonda INSTEAD OF pipe_whatsapp: a view escreve stage_key, o espelho
--     preenche stage_id (shape da view intocado) ────────────────────────────
DO $$
DECLARE
  v_org   uuid;
  v_pipe  uuid;
  v_lead  uuid;
  v_a     public.pipeline_stages%ROWTYPE;
  v_b     public.pipeline_stages%ROWTYPE;
  v_id    uuid := gen_random_uuid();
  v_check public.pipeline_entries%ROWTYPE;
BEGIN
  -- Org com funil whatsapp de sistema, 2+ etapas ativas 'open' (fora de
  -- 'agendado') e SEM regra de dispatch ativa (sonda não deve nem enfileirar).
  SELECT p.organization_id, p.id INTO v_org, v_pipe
  FROM public.pipelines p
  WHERE p.slug = 'whatsapp' AND p.type = 'system'
    AND (SELECT count(*) FROM public.pipeline_stages ps
          WHERE ps.pipeline_id = p.id AND ps.is_active
            AND ps.stage_role = 'open' AND ps.stage_key NOT IN ('agendado','compareceu')) >= 2
    AND NOT EXISTS (SELECT 1 FROM public.pipe_dispatch_rules r
                     WHERE r.organization_id = p.organization_id
                       AND r.pipe_type = 'whatsapp' AND r.is_active)
  LIMIT 1;
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: nenhum funil whatsapp elegível para a sonda pipe_*';
  END IF;

  SELECT l.id INTO v_lead
  FROM public.leads l
  WHERE l.organization_id = v_org
    AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                     WHERE pe.pipeline_id = v_pipe AND pe.lead_id = l.id)
  LIMIT 1;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: nenhum lead fora do funil whatsapp da org % para a sonda', v_org;
  END IF;

  SELECT * INTO v_a FROM public.pipeline_stages
  WHERE pipeline_id = v_pipe AND is_active AND stage_role = 'open' AND stage_key NOT IN ('agendado','compareceu')
  ORDER BY position LIMIT 1;
  SELECT * INTO v_b FROM public.pipeline_stages
  WHERE pipeline_id = v_pipe AND is_active AND stage_role = 'open' AND stage_key NOT IN ('agendado','compareceu')
    AND id <> v_a.id
  ORDER BY position LIMIT 1;

  BEGIN
    INSERT INTO public.pipe_whatsapp (id, lead_id, organization_id, status)
    VALUES (v_id, v_lead, v_org, v_a.stage_key);
    SELECT * INTO v_check FROM public.pipeline_entries WHERE id = v_id;
    IF NOT FOUND OR v_check.stage_id IS DISTINCT FROM v_a.id THEN
      RAISE EXCEPTION 'SONDA PIPE FALHOU: INSERT via view não espelhou stage_id (% vs %)', v_check.stage_id, v_a.id;
    END IF;

    UPDATE public.pipe_whatsapp SET status = v_b.stage_key WHERE id = v_id;
    SELECT * INTO v_check FROM public.pipeline_entries WHERE id = v_id;
    IF v_check.stage_id IS DISTINCT FROM v_b.id THEN
      RAISE EXCEPTION 'SONDA PIPE FALHOU: UPDATE via view não re-resolveu stage_id (% vs %)', v_check.stage_id, v_b.id;
    END IF;

    -- Limpeza absoluta via subtransação (desfaz card + efeitos de AFTER triggers).
    RAISE EXCEPTION 'E617_SONDA_PIPE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'E617_SONDA_PIPE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.pipeline_entries WHERE id = v_id) THEN
    RAISE EXCEPTION 'SONDA PIPE FALHOU: linha sintética sobreviveu à limpeza';
  END IF;
  RAISE NOTICE 'verde: sonda pipe_whatsapp OK (INSTEAD OF escreve stage_key, espelho preenche stage_id)';
END $$;

-- ─── Sonda sync custom_pipe_entries: o sync escreve stage_key resolvido da
--     view de compat; o espelho preenche stage_id no entry ─────────────────
DO $$
DECLARE
  v_org   uuid;
  v_pipe  uuid;
  v_lead  uuid;
  v_stage public.pipeline_stages%ROWTYPE;
  v_id    uuid := gen_random_uuid();
  v_check public.pipeline_entries%ROWTYPE;
BEGIN
  SELECT p.organization_id, p.id INTO v_org, v_pipe
  FROM public.pipelines p
  WHERE p.type = 'custom'
    AND EXISTS (SELECT 1 FROM public.pipeline_stages ps
                 WHERE ps.pipeline_id = p.id AND ps.is_active
                   AND ps.stage_role = 'open' AND ps.stage_key NOT IN ('agendado','compareceu'))
  LIMIT 1;
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: nenhum funil custom elegível para a sonda de sync';
  END IF;

  SELECT l.id INTO v_lead
  FROM public.leads l
  WHERE l.organization_id = v_org
    AND NOT EXISTS (SELECT 1 FROM public.custom_pipe_entries ce
                     WHERE ce.pipeline_id = v_pipe AND ce.lead_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                     WHERE pe.pipeline_id = v_pipe AND pe.lead_id = l.id)
  LIMIT 1;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: nenhum lead fora do funil custom % para a sonda de sync', v_pipe;
  END IF;

  SELECT * INTO v_stage FROM public.pipeline_stages
  WHERE pipeline_id = v_pipe AND is_active AND stage_role = 'open' AND stage_key NOT IN ('agendado','compareceu')
  ORDER BY position LIMIT 1;

  BEGIN
    INSERT INTO public.custom_pipe_entries (id, organization_id, pipeline_id, lead_id, stage_id)
    VALUES (v_id, v_org, v_pipe, v_lead, v_stage.id);

    SELECT * INTO v_check FROM public.pipeline_entries WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SONDA SYNC FALHOU: sync_custom_pipe_to_entries não criou o entry';
    END IF;
    IF v_check.stage_key IS DISTINCT FROM v_stage.stage_key
       OR v_check.stage_id IS DISTINCT FROM v_stage.id THEN
      RAISE EXCEPTION 'SONDA SYNC FALHOU: entry chegou com stage_key=% stage_id=% (esperado % / %)',
        v_check.stage_key, v_check.stage_id, v_stage.stage_key, v_stage.id;
    END IF;

    RAISE EXCEPTION 'E617_SONDA_SYNC_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'E617_SONDA_SYNC_ROLLBACK' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.pipeline_entries WHERE id = v_id)
     OR EXISTS (SELECT 1 FROM public.custom_pipe_entries WHERE id = v_id) THEN
    RAISE EXCEPTION 'SONDA SYNC FALHOU: linha sintética sobreviveu à limpeza';
  END IF;
  RAISE NOTICE 'verde: sonda sync custom_pipe_entries OK (sync escreve stage_key, espelho preenche stage_id)';
END $$;
