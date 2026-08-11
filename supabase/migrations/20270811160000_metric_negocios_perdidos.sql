-- 20270811160000_metric_negocios_perdidos.sql
--
-- SCRUM-311, fatia 5 de 19: "Negócios perdidos".
--
-- ISTO É A METADE QUE FALTAVA DE "GANHO E PERDA"
--
-- O catálogo do Estúdio lista `ganho_perda` ("Negócios ganhos contra perdidos
-- na janela") como UM item. Não é uma medida: são dois números, e o motor não
-- tem recorte 'resultado' que os separe. Metade já existe — `num_vendas` conta
-- os ganhos desde o começo. O que faltava era esta.
--
-- Portanto `ganho_perda` na tela = `num_vendas` e `negocios_perdidos` lado a
-- lado, e não uma medida nova com corte inventado. Inventar um recorte
-- 'resultado' custaria uma entrada no catálogo fechado para expressar o que
-- duas medidas já dizem melhor — e cortes existem para fatiar UMA medida, não
-- para unir duas.
--
-- FONTE: `sale_events` com `event_type = 'sale_lost'`, o mesmo livro-razão de
-- onde saem receita e num_vendas (ADR-0017 §2-4). Medido em prod 2026-08-11:
-- 319 linhas, todas com `sold_at`, desde 2026-05-08.
--
-- POR QUE LEAF PRÓPRIO E NÃO UM TERCEIRO MODO EM `_metric_leaf_sales`
--
-- Aquela função tem 7.367 caracteres e é quem calcula RECEITA. Acrescentar um
-- modo exigiria reescrevê-la inteira, e um erro de transcrição num dos ramos
-- moveria o número mais sensível do produto — para entregar uma contagem.
-- Duplicação de forma custa menos que risco em dinheiro. Este leaf lê a mesma
-- tabela com o mesmo desenho, mas não toca no caminho da receita.
--
-- A EXCLUSÃO DE ESTORNO É INERTE HOJE, E FICA
--
-- `sale_reversed` aponta para vendas. Medido: ZERO estornos apontam para uma
-- perda. A cláusula NOT EXISTS abaixo, portanto, não muda número nenhum hoje.
-- Ela fica porque o dia em que "desfazer perda" virar evento, a medida já
-- estará certa — e porque divergir da forma do leaf irmão convidaria alguém a
-- concluir que a diferença é intencional.
--
-- RECORTES: total, closer, origem, pipeline, tempo.
--
-- Sem 'tag' e sem 'produto', que `receita` oferece: a pergunta que esta medida
-- responde é "onde estamos perdendo", e responsável/origem/funil/tempo cobrem
-- isso. Recorte que ninguém pediu é superfície para manter. Sem 'stream'
-- também — fluxo de receita não classifica quem não gerou receita.
--
-- ROLLBACK pareado: rollback/20270811160000_metric_negocios_perdidos.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('negocios_perdidos', 'Negócios perdidos', 'count', 'fechamentos',
   'Negócios marcados como perdidos na janela. Metade de "ganho e perda" — a outra é Nº de vendas.', 25)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('negocios_perdidos', 'total'),
  ('negocios_perdidos', 'closer'),
  ('negocios_perdidos', 'origem'),
  ('negocios_perdidos', 'pipeline'),
  ('negocios_perdidos', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('negocios_perdidos', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — LEAF
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_sales_lost(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.sale_events w
  LEFT JOIN public.leads l ON l.id = w.lead_id
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale_lost'
    AND w.sold_at <@ p_bounds
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                    WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
    AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key,
           'label', COALESCE(
             CASE p_recorte WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM') ELSE g.bucket_label END,
             'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'closer'   THEN w.sale_responsible_id::text
        WHEN 'origem'   THEN l.origin
        WHEN 'pipeline' THEN w.pipeline_id::text
        WHEN 'tempo'    THEN to_char(w.sold_at AT TIME ZONE p_tz, 'YYYY-MM-DD')
      END AS bucket_key,
      CASE p_recorte
        WHEN 'closer'   THEN tm.name
        WHEN 'origem'   THEN l.origin
        WHEN 'pipeline' THEN pip.name
        WHEN 'tempo'    THEN NULL
      END AS bucket_label,
      COUNT(*) AS val
    FROM public.sale_events w
    LEFT JOIN public.leads l          ON l.id   = w.lead_id
    LEFT JOIN public.team_members tm  ON tm.id  = w.sale_responsible_id
    LEFT JOIN public.pipelines pip    ON pip.id = w.pipeline_id
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale_lost'
      AND w.sold_at <@ p_bounds
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
      AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

-- ===========================================================================
-- 3 — DESPACHANTE
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_tz text; v_bounds tstzrange; v_leaf jsonb;
BEGIN
  SELECT m.unit, m.anchor INTO v_unit, v_anchor
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
    WHEN 'receita'               THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'            THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_perdidos'     THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'         THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'     THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'        THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'     THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel' THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'       THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'   THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'       THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
  END;

  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- ===========================================================================
-- 4 — GRANTS E GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) TO service_role;

DO $guard$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: anon executa % — REVOKE não pegou', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: authenticated executa % — interno não pode', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
    END IF;
  END LOOP;

  -- `receita` e `num_vendas` NÃO podem ter sido tocadas por esta migration.
  -- Se `_metric_leaf_sales` sumiu ou trocou de assinatura, o despachante acima
  -- ficaria apontando para o vazio e a receita pararia — falha que só
  -- apareceria quando alguém abrisse a janela.
  IF to_regprocedure('public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_sales não está no lugar — o caminho da receita quebrou';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;
