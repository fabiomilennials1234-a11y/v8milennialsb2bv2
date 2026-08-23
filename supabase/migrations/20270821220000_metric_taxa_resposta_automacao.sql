-- 20270821220000_metric_taxa_resposta_automacao.sql
--
-- SCRUM-421 (decisão registrada no SCRUM-365) — taxa de resposta por automação.
--
-- A DECISÃO
--
-- CTO, 2026-08-21: numerador = leads que responderam em até 72h do disparo.
-- Denominador = disparos ENTREGUES — não leads alcançados, não disparos
-- enfileirados. "Entregue é o único ponto em que a mensagem comprovadamente
-- chegou."
--
-- ONDE ESTÃO OS DISPAROS (e não é onde o card supunha)
--
-- O card apontava `outbound_dispatches` / `uazapi_sender_jobs`. Medido em
-- produção em 2026-08-21: `outbound_dispatch_log` está VAZIA. Quem guarda o
-- disparo é `whatsapp_messages.sent_source`, e com volume real nos últimos 60
-- dias:
--
--     manual     477.118    sent_by_ai = false
--     workflow    64.469    sent_by_ai = true
--     copilot     13.873    sent_by_ai = true
--
-- Automação = `sent_source IN ('workflow','copilot')`. `manual` fica fora: a
-- pergunta é sobre o que a MÁQUINA disparou.
--
-- O QUE "ENTREGUE" SIGNIFICA AQUI, E O QUE ISSO CUSTA
--
-- Distribuição medida dos disparos de automação em 60 dias:
--
--     read       32.279
--     delivered  23.285
--     sent       22.717
--     failed         62
--
-- `delivered` e `read` são entrega confirmada. `sent` saiu do nosso lado e
-- nunca voltou recibo — pode ter chegado, pode não ter. Incluí-lo infla o
-- denominador com o que não se sabe, que é justamente o que a decisão recusou.
--
-- ⚠ O CUSTO ESTÁ MEDIDO E É GRANDE: `sent` é 40% do volume. A taxa publicada
-- será mais ALTA do que uma conta que incluísse tudo. Se algum dia a taxa de
-- recibo do provedor cair, este denominador encolhe e a taxa sobe sem que a
-- operação tenha melhorado — vale olhar os dois números juntos antes de
-- comemorar.
--
-- 72 HORAS A PARTIR DO DISPARO, POR DISPARO
--
-- A resposta conta para o disparo que a provocou: uma mensagem de entrada entre
-- o disparo e o disparo + 72h. Um lead que recebe três disparos e responde uma
-- vez conta UMA resposta para o disparo mais próximo — por isso o numerador
-- conta DISPAROS respondidos, não leads que responderam. Contar leads faria a
-- taxa passar de 100% em campanha com reenvio.
--
-- ROLLBACK pareado: rollback/20270821220000_metric_taxa_resposta_automacao.sql

-- ===========================================================================
-- 1 — CATÁLOGO: duas medidas, uma razão
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('disparos_entregues', 'Disparos entregues', 'count', 'entradas',
   'Mensagens de automação (workflow ou copilot) com entrega confirmada.', 49),
  ('disparos_respondidos', 'Disparos respondidos', 'count', 'entradas',
   'Disparos de automação que receberam resposta do lead em até 72h.', 50)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('disparos_entregues', 'total'), ('disparos_entregues', 'tempo'), ('disparos_entregues', 'origem'),
  ('disparos_respondidos', 'total'), ('disparos_respondidos', 'tempo'), ('disparos_respondidos', 'origem')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('disparos_entregues', 'integer'),
  ('disparos_respondidos', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — O LEAF COMPARTILHADO
-- ===========================================================================
-- Um leaf para as duas, como em `_metric_leaf_leads_qualidade`: são a MESMA
-- consulta com um predicado a mais. Dois leaves seriam dois lugares para o
-- filtro de automação divergir, e numerador que não é subconjunto do
-- denominador produz taxa acima de 100%.
CREATE OR REPLACE FUNCTION public._metric_leaf_automacao(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text,
  p_filters jsonb, p_criterio text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val bigint; v_series jsonb; v_base bigint;
BEGIN
  IF p_criterio NOT IN ('entregues', 'respondidos') THEN
    RAISE EXCEPTION 'unknown criterio % for automacao', p_criterio USING ERRCODE = '22023';
  END IF;
  IF p_recorte NOT IN ('total', 'tempo', 'origem') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure automacao', p_recorte
      USING ERRCODE = '22023';
  END IF;

  -- Base para `empty_reason`: houve disparo de automação na janela? "Nenhuma
  -- resposta" é resposta; "esta org não usa automação" é ausência.
  SELECT count(*) INTO v_base
  FROM public.whatsapp_messages m
  WHERE m.organization_id = p_org_id
    AND m.direction = 'outgoing'
    AND m.sent_source IN ('workflow', 'copilot')
    AND m.deleted_at IS NULL
    AND m.timestamp <@ p_bounds;

  IF p_recorte = 'total' THEN
    SELECT count(*) INTO v_val
    FROM public.whatsapp_messages m
    LEFT JOIN public.leads l ON l.id = m.lead_id
    WHERE m.organization_id = p_org_id
      AND m.direction = 'outgoing'
      AND m.sent_source IN ('workflow', 'copilot')
      AND m.status IN ('delivered', 'read')
      AND m.deleted_at IS NULL
      AND m.timestamp <@ p_bounds
      AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
      AND (p_criterio = 'entregues' OR EXISTS (
            SELECT 1 FROM public.whatsapp_messages r
            WHERE r.organization_id = m.organization_id
              AND r.lead_id = m.lead_id
              AND r.direction = 'incoming'
              AND r.deleted_at IS NULL
              AND r.timestamp > m.timestamp
              AND r.timestamp <= m.timestamp + interval '72 hours'));

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
  END IF;

  -- tempo | origem
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key, 'label', g.bucket_label, 'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'tempo'  THEN to_char((m.timestamp AT TIME ZONE p_tz)::date, 'YYYY-MM-DD')
        ELSE               COALESCE(l.origin, 'sem_origem')
      END AS bucket_key,
      CASE p_recorte
        WHEN 'tempo'  THEN to_char((m.timestamp AT TIME ZONE p_tz)::date, 'DD/MM')
        ELSE               COALESCE(l.origin, 'Sem origem')
      END AS bucket_label,
      count(*) AS val
    FROM public.whatsapp_messages m
    LEFT JOIN public.leads l ON l.id = m.lead_id
    WHERE m.organization_id = p_org_id
      AND m.direction = 'outgoing'
      AND m.sent_source IN ('workflow', 'copilot')
      AND m.status IN ('delivered', 'read')
      AND m.deleted_at IS NULL
      AND m.timestamp <@ p_bounds
      AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
      AND (p_criterio = 'entregues' OR EXISTS (
            SELECT 1 FROM public.whatsapp_messages r
            WHERE r.organization_id = m.organization_id
              AND r.lead_id = m.lead_id
              AND r.direction = 'incoming'
              AND r.deleted_at IS NULL
              AND r.timestamp > m.timestamp
              AND r.timestamp <= m.timestamp + interval '72 hours'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text) IS
  'SCRUM-421 — disparos de automação (workflow/copilot) ENTREGUES, e os que receberam resposta em 72h. Um leaf para as duas: numerador tem que ser subconjunto do denominador, senão a taxa passa de 100%.';

-- ===========================================================================
-- 3 — DESPACHANTE (corpo vigente de 20270821210000 + DOIS ramos)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_goal_type text; v_tz text;
  v_bounds tstzrange; v_leaf jsonb; v_target numeric;
BEGIN
  SELECT m.unit, m.anchor, m.goal_type INTO v_unit, v_anchor, v_goal_type
  FROM public.metric_catalog_measures m WHERE m.id = p_measure_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'unknown measure %', p_measure_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = p_measure_id AND mr.recorte_id = p_recorte
  ) THEN
    RAISE EXCEPTION 'recorte % incompatible with measure %', p_recorte, p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_anchor <> 'hoje' THEN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  END IF;

  v_leaf := CASE p_measure_id
    WHEN 'receita'                THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'ltv'                    THEN public._metric_leaf_ltv(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas_pre_venda'   THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters, true)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'ganho_perda'            THEN public._metric_leaf_ganho_perda(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'negocio')
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'lead')
    WHEN 'negocios_abertos'       THEN public._metric_leaf_negocios_abertos(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'clientes_sem_resposta'  THEN public._metric_leaf_clientes_sem_resposta(p_org_id, p_recorte, p_filters)
    WHEN 'disparos_entregues'     THEN public._metric_leaf_automacao(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'entregues')
    WHEN 'disparos_respondidos'   THEN public._metric_leaf_automacao(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'respondidos')
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    -- SCRUM-316. As três partilham a MESMA coorte; ver o cabeçalho da 20270821120000.
    WHEN 'negocios_coorte_origem'      THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'origem')
    WHEN 'negocios_coorte_convertidos' THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'convertidos')
    WHEN 'negocios_coorte_em_aberto'   THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'em_aberto')
  END;

  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_goal_type IS NOT NULL AND v_bounds IS NOT NULL THEN
    SELECT sum(g.target_value) INTO v_target
    FROM public.goals g
    WHERE g.organization_id = p_org_id
      AND g.type = v_goal_type
      AND g.month = extract(month FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND g.year  = extract(year  FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND (
        ((p_filters->>'member_id') IS NULL AND g.team_member_id IS NULL)
        OR g.team_member_id = (p_filters->>'member_id')::uuid
      );
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'target',  v_target,
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- ===========================================================================
-- 4 — GRANTS + GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_sem_ramo text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: anon executa % — interno do motor não pode', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: authenticated executa % — interno do motor não pode', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef(
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure);

  SELECT string_agg(m.id, ', ') INTO v_sem_ramo
  FROM public.metric_catalog_measures m
  WHERE position(quote_literal(m.id) IN v_def) = 0;

  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida(s) catalogada(s) sem ramo no despachante: %', v_sem_ramo;
  END IF;
END
$guard$;
