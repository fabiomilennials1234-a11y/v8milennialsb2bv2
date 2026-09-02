-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-631 — DEPOIS: com a migration aplicada (na transação), prova:
-- (1) ACL das 4 assinaturas novas idêntica ao snapshot das legadas;
-- (2) byte-a-byte onde a semântica NÃO mudou: velocity propostas/default,
--     sales_cycle sem filtro, metrics {funnel_stages, stage_analysis,
--     pipeline_total, conversion_trends[0..2]}, conjunto de etapas do
--     funnel_conversion;
-- (3) prova de que o funnel_conversion legado estava MORTO (0 entradas em
--     todo baseline) — pré-condição do delta D-fc;
-- (4) deltas MEDIDOS onde a semântica mudou (D-fc, D-vel, D-sc, D-agz, D-fx,
--     D-mw), anexados ao relatório final;
-- (5) caminhos novos por pipeline_id vivos em funil custom;
-- e ABORTA com ENSAIO_OK carregando o relatório. ROLLBACK final: nada aplica.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A) ACL: novas assinaturas espelham o snapshot ──────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT g.fn, g.anon_x, g.auth_x, g.sr_x,
           bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))          AS anon_agora,
           bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth_agora,
           bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))  AS sr_agora,
           count(*) AS n_sigs
    FROM _e631_grants g
    JOIN pg_proc p ON p.proname = g.fn
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    GROUP BY g.fn, g.anon_x, g.auth_x, g.sr_x
  LOOP
    IF r.n_sigs <> 1 THEN
      RAISE EXCEPTION 'FAIL ACL: % tem % assinaturas (esperado 1 — a velha devia ter caído)', r.fn, r.n_sigs;
    END IF;
    IF (r.anon_agora, r.auth_agora, r.sr_agora) IS DISTINCT FROM (r.anon_x, r.auth_x, r.sr_x) THEN
      RAISE EXCEPTION 'FAIL ACL: % era (anon=%,auth=%,sr=%) e ficou (anon=%,auth=%,sr=%)',
        r.fn, r.anon_x, r.auth_x, r.sr_x, r.anon_agora, r.auth_agora, r.sr_agora;
    END IF;
  END LOOP;
  RAISE NOTICE 'A ok: ACL espelhada nas 4 assinaturas novas.';
END $$;

-- ─── B..E) Paridades, deltas e sondas ───────────────────────────────────────
DO $$
DECLARE
  o record;
  s text;
  v_start timestamptz := '2026-06-01+00';
  v_end   timestamptz := '2026-09-01+00';
  v_n bigint;
  v_n2 bigint;
  v_dead bigint;
  v_old jsonb;
  v_new jsonb;
  v_cus uuid;
  v_cus_stages int;
BEGIN
  -- B0: pré-condição do D-fc — baseline do funnel_conversion morto (0 entradas).
  SELECT COALESCE(SUM(total_entered), 0) INTO v_dead FROM _e631_fc;
  IF v_dead <> 0 THEN
    RAISE EXCEPTION 'FAIL premissa D-fc: baseline legado tem % entradas (esperado 0 — to_stage_id nunca foi escrito)', v_dead;
  END IF;
  INSERT INTO _e631_report (line) VALUES
    ('D-fc premissa provada: legado casou 0 entradas em 3 orgs x 3 funis (feature morta desde o nascimento).');

  FOR o IN SELECT * FROM _e631_orgs ORDER BY k LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', o.uid, 'role', 'authenticated')::text, true);

    -- ── B) funnel_conversion ────────────────────────────────────────────────
    FOREACH s IN ARRAY ARRAY['whatsapp', 'confirmacao', 'propostas'] LOOP
      -- Conjunto de etapas idêntico (pipeline_id substitui pipeline_type sem perda).
      SELECT count(*) INTO v_n FROM (
        (SELECT stage_id, stage_name, stage_order
           FROM public.get_funnel_conversion(s, v_start, v_end)
         EXCEPT
         SELECT stage_id, stage_name, stage_order FROM _e631_fc f WHERE f.org_k = o.k AND f.slug = s)
        UNION ALL
        (SELECT stage_id, stage_name, stage_order FROM _e631_fc f WHERE f.org_k = o.k AND f.slug = s
         EXCEPT
         SELECT stage_id, stage_name, stage_order
           FROM public.get_funnel_conversion(s, v_start, v_end))
      ) d;
      IF v_n <> 0 THEN
        RAISE EXCEPTION 'FAIL fc %/%: conjunto de etapas divergiu em % linha(s)', o.k, s, v_n;
      END IF;
      SELECT COALESCE(SUM(f.total_entered), 0) INTO v_n
        FROM public.get_funnel_conversion(s, v_start, v_end) f;
      INSERT INTO _e631_report (line)
        VALUES (format('D-fc %s/%s: entradas 0 -> %s (mesmas etapas).', o.k, s, v_n));
    END LOOP;

    -- Sonda por pipeline_id em funil custom: devolve exatamente as etapas dele.
    SELECT c.pipeline_id, c.n_stages INTO v_cus, v_cus_stages
      FROM _e631_custom c WHERE c.org_k = o.k;
    IF v_cus IS NOT NULL THEN
      SELECT count(*) INTO v_n
        FROM public.get_funnel_conversion(NULL, v_start, v_end, o.org_id, v_cus);
      IF v_n <> v_cus_stages THEN
        RAISE EXCEPTION 'FAIL fc custom %: % etapas devolvidas, funil tem %', o.k, v_n, v_cus_stages;
      END IF;
      SELECT COALESCE(SUM(f.total_entered), 0) INTO v_n
        FROM public.get_funnel_conversion(NULL, v_start, v_end, o.org_id, v_cus) f;
      INSERT INTO _e631_report (line)
        VALUES (format('fc custom %s (funil %s): %s etapas, %s entradas no periodo.', o.k, v_cus, v_cus_stages, v_n));
    END IF;

    -- ── C) velocity ─────────────────────────────────────────────────────────
    -- propostas: byte-a-byte (vendido<->won 105/105 medido).
    SELECT b.j INTO v_old FROM _e631_vel b WHERE b.org_k = o.k AND b.slug = 'propostas';
    v_new := public.get_pipeline_velocity('propostas', v_start, v_end);
    IF v_new IS DISTINCT FROM v_old THEN
      RAISE EXCEPTION 'FAIL vel %/propostas: % -> %', o.k, v_old, v_new;
    END IF;
    -- default (NULL -> propostas): byte-a-byte com o baseline __all__.
    SELECT b.j INTO v_old FROM _e631_vel b WHERE b.org_k = o.k AND b.slug = '__all__';
    v_new := public.get_pipeline_velocity(NULL, v_start, v_end);
    IF v_new IS DISTINCT FROM v_old THEN
      RAISE EXCEPTION 'FAIL vel %/default: % -> %', o.k, v_old, v_new;
    END IF;
    INSERT INTO _e631_report (line)
      VALUES (format('vel %s: propostas e default byte-a-byte.', o.k));
    -- whatsapp/confirmacao: delta D-vel (stage_role no lugar de slug).
    FOREACH s IN ARRAY ARRAY['whatsapp', 'confirmacao'] LOOP
      SELECT b.j INTO v_old FROM _e631_vel b WHERE b.org_k = o.k AND b.slug = s;
      v_new := public.get_pipeline_velocity(s, v_start, v_end);
      IF v_new IS DISTINCT FROM v_old THEN
        INSERT INTO _e631_report (line)
          VALUES (format('D-vel %s/%s: %s -> %s', o.k, s, v_old, v_new));
      ELSE
        INSERT INTO _e631_report (line)
          VALUES (format('vel %s/%s: byte-a-byte.', o.k, s));
      END IF;
    END LOOP;
    -- Sonda custom: shape completo.
    IF v_cus IS NOT NULL THEN
      v_new := public.get_pipeline_velocity(NULL, v_start, v_end, o.org_id, v_cus);
      IF NOT (v_new ? 'num_won' AND v_new ? 'total_closed' AND v_new ? 'win_rate' AND v_new ? 'avg_deal_value') THEN
        RAISE EXCEPTION 'FAIL vel custom %: shape incompleto %', o.k, v_new;
      END IF;
      INSERT INTO _e631_report (line)
        VALUES (format('vel custom %s: %s', o.k, v_new));
    END IF;

    -- ── D) sales_cycle ──────────────────────────────────────────────────────
    -- Sem filtro: byte-a-byte.
    SELECT count(*) INTO v_n FROM (
      (SELECT * FROM public.get_sales_cycle_analysis(NULL, v_start, v_end, o.org_id)
       EXCEPT
       SELECT c.from_stage, c.to_stage, c.avg_hours, c.median_hours, c.transition_count
         FROM _e631_sc c WHERE c.org_k = o.k AND c.slug = '__all__')
      UNION ALL
      (SELECT c.from_stage, c.to_stage, c.avg_hours, c.median_hours, c.transition_count
         FROM _e631_sc c WHERE c.org_k = o.k AND c.slug = '__all__'
       EXCEPT
       SELECT * FROM public.get_sales_cycle_analysis(NULL, v_start, v_end, o.org_id))
    ) d;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'FAIL sc %/todas: divergiu do baseline em % linha(s)', o.k, v_n;
    END IF;
    INSERT INTO _e631_report (line)
      VALUES (format('sc %s/todas-as-transicoes: byte-a-byte.', o.k));
    -- Filtrado por funil: delta D-sc (metadata.pipeline_id no lugar do ILIKE).
    FOREACH s IN ARRAY ARRAY['whatsapp', 'confirmacao', 'propostas'] LOOP
      SELECT COALESCE(SUM(c.transition_count), 0) INTO v_n
        FROM _e631_sc c WHERE c.org_k = o.k AND c.slug = s;
      SELECT COALESCE(SUM(c.transition_count), 0) INTO v_n2
        FROM public.get_sales_cycle_analysis(s, v_start, v_end, o.org_id) c;
      INSERT INTO _e631_report (line)
        VALUES (format('D-sc %s/%s: transicoes %s -> %s', o.k, s, v_n, v_n2));
    END LOOP;
    IF v_cus IS NOT NULL THEN
      SELECT COALESCE(SUM(c.transition_count), 0) INTO v_n
        FROM public.get_sales_cycle_analysis(NULL, v_start, v_end, o.org_id, v_cus) c;
      INSERT INTO _e631_report (line)
        VALUES (format('sc custom %s: %s transicoes no funil %s.', o.k, v_n, v_cus));
    END IF;

    -- ── E) metrics ──────────────────────────────────────────────────────────
    SELECT b.j INTO v_old FROM _e631_met b WHERE b.org_k = o.k AND b.slug = '__all__';
    v_new := public.get_analytics_pipeline_metrics(o.org_id, '2026-06-01', '2026-09-01', NULL, NULL);
    -- Jornada da org: byte-a-byte.
    IF v_new->'funnel_stages' IS DISTINCT FROM v_old->'funnel_stages' THEN
      RAISE EXCEPTION 'FAIL met %: funnel_stages divergiu: % -> %', o.k, v_old->'funnel_stages', v_new->'funnel_stages';
    END IF;
    IF v_new->'stage_analysis' IS DISTINCT FROM v_old->'stage_analysis' THEN
      RAISE EXCEPTION 'FAIL met %: stage_analysis divergiu', o.k;
    END IF;
    IF v_new->'pipeline_total' IS DISTINCT FROM v_old->'pipeline_total' THEN
      RAISE EXCEPTION 'FAIL met %: pipeline_total divergiu: % -> %', o.k, v_old->'pipeline_total', v_new->'pipeline_total';
    END IF;
    FOR v_n IN 0..2 LOOP
      IF v_new->'conversion_trends'->v_n::int IS DISTINCT FROM v_old->'conversion_trends'->v_n::int THEN
        RAISE EXCEPTION 'FAIL met %: conversion_trends[%] divergiu', o.k, v_n;
      END IF;
    END LOOP;
    INSERT INTO _e631_report (line)
      VALUES (format('met %s: funnel_stages, stage_analysis, pipeline_total e trends[0..2] byte-a-byte.', o.k));
    -- Deltas D-mw / D-agz / D-fx (sem filtro).
    IF v_new->'conversion_trends'->3 IS DISTINCT FROM v_old->'conversion_trends'->3 THEN
      INSERT INTO _e631_report (line)
        VALUES (format('D-mw %s: trends[Proposta->Venda] %s -> %s', o.k,
          v_old->'conversion_trends'->3->'months', v_new->'conversion_trends'->3->'months'));
    ELSE
      INSERT INTO _e631_report (line) VALUES (format('met %s: trends[3] byte-a-byte.', o.k));
    END IF;
    INSERT INTO _e631_report (line)
      VALUES (format('D-agz %s (sem filtro): aging %s etapas/%s cards -> %s etapas/%s cards', o.k,
        jsonb_array_length(v_old->'pipeline_aging'),
        (SELECT COALESCE(SUM((e->>'total')::bigint), 0) FROM jsonb_array_elements(v_old->'pipeline_aging') e),
        jsonb_array_length(v_new->'pipeline_aging'),
        (SELECT COALESCE(SUM((e->>'total')::bigint), 0) FROM jsonb_array_elements(v_new->'pipeline_aging') e)));
    INSERT INTO _e631_report (line)
      VALUES (format('D-fx %s (sem filtro): forecast %s etapas/total %s -> %s etapas/total %s', o.k,
        jsonb_array_length(v_old->'weighted_forecast'), v_old->'forecast_total',
        jsonb_array_length(v_new->'weighted_forecast'), v_new->'forecast_total'));
    -- Filtrado por slug: gates preservados + delta de aging.
    FOREACH s IN ARRAY ARRAY['whatsapp', 'confirmacao', 'propostas'] LOOP
      SELECT b.j INTO v_old FROM _e631_met b WHERE b.org_k = o.k AND b.slug = s;
      v_new := public.get_analytics_pipeline_metrics(o.org_id, '2026-06-01', '2026-09-01', s, NULL);
      IF v_new->'funnel_stages' <> '[]'::jsonb OR v_new->'stage_analysis' <> '[]'::jsonb THEN
        RAISE EXCEPTION 'FAIL met %/%: gate de jornada quebrou com filtro', o.k, s;
      END IF;
      INSERT INTO _e631_report (line)
        VALUES (format('D-agz %s/%s: aging %s/%s cards -> %s/%s cards', o.k, s,
          jsonb_array_length(v_old->'pipeline_aging'),
          (SELECT COALESCE(SUM((e->>'total')::bigint), 0) FROM jsonb_array_elements(v_old->'pipeline_aging') e),
          jsonb_array_length(v_new->'pipeline_aging'),
          (SELECT COALESCE(SUM((e->>'total')::bigint), 0) FROM jsonb_array_elements(v_new->'pipeline_aging') e)));
    END LOOP;
    -- Sonda custom por pipeline_id.
    IF v_cus IS NOT NULL THEN
      v_new := public.get_analytics_pipeline_metrics(o.org_id, '2026-06-01', '2026-09-01', NULL, NULL, v_cus);
      IF v_new->'funnel_stages' <> '[]'::jsonb THEN
        RAISE EXCEPTION 'FAIL met custom %: jornada devia estar gated', o.k;
      END IF;
      INSERT INTO _e631_report (line)
        VALUES (format('met custom %s: aging %s etapas/%s cards, forecast_total %s.', o.k,
          jsonb_array_length(v_new->'pipeline_aging'),
          (SELECT COALESCE(SUM((e->>'total')::bigint), 0) FROM jsonb_array_elements(v_new->'pipeline_aging') e),
          v_new->'forecast_total'));
    END IF;
  END LOOP;
END $$;

-- ─── ENSAIO_OK: aborta com o relatório ──────────────────────────────────────
DO $$
DECLARE v_report text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY seq) INTO v_report FROM _e631_report;
  RAISE EXCEPTION E'ENSAIO_OK SCRUM-631 — analytics por pipeline_id: ACL espelhada, paridade byte-a-byte onde a semântica não mudou, deltas medidos e sondas custom vivas (tudo rolado).\n%', v_report;
END $$;

ROLLBACK;
