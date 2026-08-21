-- 20270821230000_metric_clientes_sem_atuacao.sql
--
-- SCRUM-420 (decisão registrada no SCRUM-365) — clientes sem nenhuma atuação.
--
-- A DECISÃO
--
-- CTO, 2026-08-21: "atuação" inclui mensagem (entrada OU saída), reunião,
-- mudança de etapa, criação de negócio E pedido. Janela padrão de 30 dias.
--
-- `carteira.days_since_last_order` cobre SÓ pedido, e por isso não serve
-- sozinha: um cliente que trocou mensagens ontem e não compra há 60 dias não
-- está abandonado — está em negociação.
--
-- O SUJEITO É O CLIENTE DA CARTEIRA, NÃO O LEAD
--
-- O brief do SCRUM-11 diz "clientes". `upsell_clients` é quem carrega essa
-- identidade — quem já comprou e virou carteira de alguém. Contar leads daria
-- outra pergunta ("prospect esquecido"), que é legítima e não é esta.
--
-- Cliente INATIVO (`is_active = false`) fica fora: ele não está esquecido, foi
-- desligado de propósito.
--
-- CINCO FONTES, UM `GREATEST`
--
-- Cada toque mora numa tabela diferente, e a data mais recente entre todas é o
-- último contato:
--
--     pedido            upsell_clients.last_order_at
--     mensagem          whatsapp_messages.timestamp     (entrada OU saída)
--     reunião           meeting_events.occurred_at
--     mudança de etapa  pipeline_stage_events.occurred_at
--     criação de negócio pipeline_entries.entered_at
--
-- Os quatro últimos são por LEAD (`upsell_clients.lead_id`), e cada subconsulta
-- é um `max` escalar correlacionado — as três tabelas grandes têm índice por
-- (organization_id, lead_id).
--
-- CLIENTE SEM TOQUE NENHUM CONTA
--
-- `GREATEST` de tudo nulo é NULL, e NULL aqui significa "nunca houve contato" —
-- que é o caso MAIS abandonado, não a ausência de resposta. Ele entra na
-- contagem desde que o cadastro seja mais velho que a janela; um cliente
-- cadastrado hoje não está esquecido há 30 dias.
--
-- ROLLBACK pareado: rollback/20270821230000_metric_clientes_sem_atuacao.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('clientes_sem_atuacao', 'Clientes sem atuação', 'count', 'hoje',
   'Clientes da carteira sem nenhum toque há 30 dias — pedido, mensagem, reunião, etapa ou negócio.', 51)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

-- Sem `tempo`: é estado. `closer` faz sentido aqui, ao contrário de
-- `clientes_sem_resposta`: o cliente da carteira TEM dono declarado
-- (`closer_id`), e "a carteira de quem está parada" é a pergunta do gestor.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('clientes_sem_atuacao', 'total'),
  ('clientes_sem_atuacao', 'closer')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('clientes_sem_atuacao', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 1.5 — O ÚLTIMO TOQUE, num lugar só
-- ===========================================================================
-- Extraída para função porque aparece DUAS vezes no leaf (total e por closer) e
-- porque "o que conta como atuação" é uma decisão de produto — quando alguém
-- acrescentar uma sexta fonte, há um lugar para acrescentar, não dois.
--
-- `-infinity` NÃO é usado aqui: a função devolve NULL quando não houve toque
-- nenhum, e quem chama decide o que fazer com isso. NULL é informação — "nunca
-- houve contato" é o caso mais abandonado de todos, e achatá-lo para uma data
-- antiga perderia a distinção.
CREATE OR REPLACE FUNCTION public._metric_ultimo_toque(
  p_org_id uuid, p_lead_id uuid, p_last_order_at timestamptz
) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT GREATEST(
    p_last_order_at,
    (SELECT max(m.timestamp) FROM public.whatsapp_messages m
      WHERE m.organization_id = p_org_id AND m.lead_id = p_lead_id AND m.deleted_at IS NULL),
    (SELECT max(e.occurred_at) FROM public.meeting_events e
      WHERE e.organization_id = p_org_id AND e.lead_id = p_lead_id),
    (SELECT max(s.occurred_at) FROM public.pipeline_stage_events s
      WHERE s.organization_id = p_org_id AND s.lead_id = p_lead_id),
    (SELECT max(pe.entered_at) FROM public.pipeline_entries pe
      WHERE pe.organization_id = p_org_id AND pe.lead_id = p_lead_id)
  );
$$;

COMMENT ON FUNCTION public._metric_ultimo_toque(uuid, uuid, timestamptz) IS
  'SCRUM-420 — data do último toque em um cliente: pedido, mensagem, reunião, mudança de etapa ou criação de negócio. NULL = nunca houve contato.';

REVOKE EXECUTE ON FUNCTION public._metric_ultimo_toque(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_ultimo_toque(uuid, uuid, timestamptz)
  TO service_role;

-- ===========================================================================
-- 2 — O LEAF
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_clientes_sem_atuacao(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_dias int;
  v_corte timestamptz;
  v_val bigint;
  v_series jsonb;
  v_base bigint;
BEGIN
  IF p_recorte NOT IN ('total', 'closer') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure clientes_sem_atuacao', p_recorte
      USING ERRCODE = '22023';
  END IF;

  -- Janela padrão de 30 dias (decisão do CTO). Constante nomeada: quando virar
  -- configuração por org, há UM lugar para mexer.
  v_dias := 30;
  v_corte := now() - make_interval(days => v_dias);

  SELECT count(*) INTO v_base
  FROM public.upsell_clients c
  WHERE c.organization_id = p_org_id
    AND c.is_active IS NOT false;

  IF p_recorte = 'total' THEN
    SELECT count(*) INTO v_val
    FROM public.upsell_clients c
    WHERE c.organization_id = p_org_id
      AND c.is_active IS NOT false
      AND c.created_at < v_corte
      AND ((p_filters->>'member_id') IS NULL OR c.closer_id = (p_filters->>'member_id')::uuid)
      AND COALESCE(public._metric_ultimo_toque(p_org_id, c.lead_id, c.last_order_at), '-infinity'::timestamptz) < v_corte;

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
  END IF;

  -- closer
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key, 'label', g.bucket_label, 'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      COALESCE(c.closer_id::text, 'sem_closer') AS bucket_key,
      COALESCE(tm.name, 'Sem responsável') AS bucket_label,
      count(*) AS val
    FROM public.upsell_clients c
    LEFT JOIN public.team_members tm ON tm.id = c.closer_id
    WHERE c.organization_id = p_org_id
      AND c.is_active IS NOT false
      AND c.created_at < v_corte
      AND COALESCE(public._metric_ultimo_toque(p_org_id, c.lead_id, c.last_order_at), '-infinity'::timestamptz) < v_corte
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb) IS
  'SCRUM-420 — clientes da carteira sem nenhum toque há 30 dias. Estado (âncora hoje). O "toque" é o GREATEST das cinco fontes, em _metric_ultimo_toque.';

-- ===========================================================================
-- 3 — DESPACHANTE (corpo vigente de 20270821220000 + UM ramo)
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
    WHEN 'clientes_sem_atuacao'   THEN public._metric_leaf_clientes_sem_atuacao(p_org_id, p_recorte, p_filters)
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
REVOKE EXECUTE ON FUNCTION public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb)'::regprocedure,
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
