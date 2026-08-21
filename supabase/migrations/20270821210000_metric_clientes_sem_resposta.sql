-- 20270821210000_metric_clientes_sem_resposta.sql
--
-- SCRUM-419 (decisão registrada no SCRUM-365) — clientes sem resposta.
--
-- A DECISÃO
--
-- CTO, 2026-08-21: CONTAGEM de clientes cuja última mensagem na conversa é
-- NOSSA e já se passaram 3 dias ou mais. Janela padrão de 3 dias.
--
-- A taxa (`response_rate_pct`, em `useAnalyticsEngajamento`) continua existindo
-- e responde OUTRA pergunta — "que fatia respondeu". Esta responde "quem está
-- esperando agora", que é a fila de trabalho do vendedor. Substituir uma pela
-- outra perderia a fila.
--
-- ÂNCORA `hoje`: É ESTADO, NÃO FLUXO
--
-- "Quem está sem resposta" é uma foto do agora. Recortar por período daria
-- "quem estava sem resposta em março", que não é pergunta que alguém faz — e
-- pior, mudaria com o seletor de período sem que o usuário entendesse por quê.
-- Mesmo desenho de `leads_sem_responsavel` e `negocios_na_etapa`.
--
-- A ÚLTIMA MENSAGEM, E POR QUE `DISTINCT ON`
--
-- O predicado é sobre a ÚLTIMA mensagem de cada lead, não sobre existir alguma
-- mensagem nossa. Um lead que respondeu ontem depois de três dias parado NÃO
-- está sem resposta, e um `EXISTS` de mensagem outgoing antiga o contaria.
--
-- `DISTINCT ON (lead_id) ... ORDER BY lead_id, timestamp DESC` casa exatamente
-- com `idx_whatsapp_msgs_org_lead (organization_id, lead_id, timestamp DESC)`,
-- que já existe — a leitura é um index scan, não uma varredura da tabela de
-- mensagens (a maior do banco).
--
-- MENSAGEM APAGADA NÃO CONTA
--
-- `deleted_at IS NOT NULL` sai da conta. Se a última mensagem foi apagada, a
-- anterior é que manda — senão o lead ficaria eternamente "sem resposta" por
-- causa de algo que ninguém mais vê.
--
-- ROLLBACK pareado: rollback/20270821210000_metric_clientes_sem_resposta.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('clientes_sem_resposta', 'Clientes sem resposta', 'count', 'hoje',
   'Clientes cuja última mensagem é nossa há 3 dias ou mais — a fila que está esperando.', 48)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

-- Sem `tempo`: é estado, não série. Sem corte por pessoa: a mensagem tem
-- remetente, mas o lead pode ter falado com três pessoas diferentes, e atribuir
-- a fila a uma delas seria escolha arbitrária disfarçada de dado.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('clientes_sem_resposta', 'total'),
  ('clientes_sem_resposta', 'origem'),
  ('clientes_sem_resposta', 'tag')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('clientes_sem_resposta', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — O LEAF
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_clientes_sem_resposta(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_dias int;
  v_val bigint;
  v_series jsonb;
  v_base bigint;
BEGIN
  IF p_recorte NOT IN ('total', 'origem', 'tag') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure clientes_sem_resposta', p_recorte
      USING ERRCODE = '22023';
  END IF;

  -- Janela padrão de 3 dias (decisão do CTO). Fica como constante nomeada em
  -- vez de literal solto: quando alguém quiser tornar isso configurável por
  -- org, há UM lugar para mexer.
  v_dias := 3;

  -- Quantos leads da coorte têm conversa? É a base de `empty_reason`: "nenhum
  -- cliente esperando" é resposta; "esta org não usa WhatsApp" é ausência.
  SELECT count(DISTINCT m.lead_id) INTO v_base
  FROM public.whatsapp_messages m
  WHERE m.organization_id = p_org_id
    AND m.lead_id IS NOT NULL
    AND m.deleted_at IS NULL;

  IF p_recorte = 'total' THEN
    SELECT count(*) INTO v_val
    FROM (
      SELECT DISTINCT ON (m.lead_id) m.lead_id, m.direction, m.timestamp
      FROM public.whatsapp_messages m
      WHERE m.organization_id = p_org_id
        AND m.lead_id IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.lead_id, m.timestamp DESC
    ) u
    JOIN public.leads l ON l.id = u.lead_id
    WHERE u.direction = 'outgoing'
      AND u.timestamp < now() - make_interval(days => v_dias)
      AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
      AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
      AND ((p_filters->>'tag_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
             WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid));

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
  END IF;

  -- origem | tag
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key, 'label', g.bucket_label, 'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte WHEN 'origem' THEN COALESCE(l.origin, 'sem_origem') ELSE t.id::text END AS bucket_key,
      CASE p_recorte WHEN 'origem' THEN COALESCE(l.origin, 'Sem origem') ELSE COALESCE(t.name, 'Sem tag') END AS bucket_label,
      count(DISTINCT l.id) AS val
    FROM (
      SELECT DISTINCT ON (m.lead_id) m.lead_id, m.direction, m.timestamp
      FROM public.whatsapp_messages m
      WHERE m.organization_id = p_org_id
        AND m.lead_id IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.lead_id, m.timestamp DESC
    ) u
    JOIN public.leads l ON l.id = u.lead_id
    LEFT JOIN public.lead_tags lt ON p_recorte = 'tag' AND lt.lead_id = l.id
    LEFT JOIN public.tags t ON t.id = lt.tag_id
    WHERE u.direction = 'outgoing'
      AND u.timestamp < now() - make_interval(days => v_dias)
      AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
      AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb) IS
  'SCRUM-419 — clientes cuja ÚLTIMA mensagem é nossa há 3 dias ou mais. Estado (âncora hoje), não fluxo. DISTINCT ON casa com idx_whatsapp_msgs_org_lead.';

-- ===========================================================================
-- 3 — DESPACHANTE (corpo vigente de 20270821200000 + UM ramo)
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
REVOKE EXECUTE ON FUNCTION public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb)'::regprocedure,
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
