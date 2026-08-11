-- 20270811130000_metric_leads_avaliados.sql
--
-- SCRUM-311, fatia 2 de 19: porta "Leads avaliados" para o catálogo fechado do
-- motor (ADR-0023). Segue o molde de `20270811120000` — uma medida por
-- migration, nunca em lote.
--
-- FONTE LEGADA
--
-- `get_funnel_health(p_org_id, ...)`, campo `stages.avaliados`, consumido por
-- `useFunnelHealth`. A definição de lá, reproduzida sem invenção:
--
--     tier_efetivo = COALESCE(qualification_tier, pre_qualification_tier)
--     avaliados    = COUNT(*) FILTER (WHERE tier_efetivo IS NOT NULL)
--
-- O `COALESCE` importa e não é detalhe: um lead pré-qualificado pela automação
-- conta como avaliado mesmo sem avaliação final humana. Trocar isso por
-- `qualification_tier IS NOT NULL` mudaria o número na tela do cliente.
--
-- A COORTE DIVERGE DA TELA LEGADA — DE PROPÓSITO, E COM CUSTO CONHECIDO
--
-- `get_funnel_health` monta a coorte com `deleted_at IS NULL` **e**
-- `NOT lead_excluded_from_metrics(id, org)`. O motor, em
-- `_metric_leaf_leads_criados`, filtra só `deleted_at IS NULL`.
--
-- Medido em prod (2026-08-11): 38.176 leads ativos, dos quais 698 marcados
-- `excluded_from_metrics` e 93 sombra. A divergência é de ~2%.
--
-- Esta migration espelha o `leads_criados`, não a tela legada. A razão é uma
-- identidade que precisa fechar DENTRO do Estúdio:
--
--     leads_avaliados + leads_nao_avaliados = leads_criados
--
-- Duas medidas lado a lado que não somam é exatamente o defeito que o ADR-0017
-- nomeia (`SUM(parte) ≠ total`). Alinhar com a tela legada quebraria a soma;
-- alinhar com o motor mantém o Estúdio coerente consigo mesmo.
--
-- ⚠ A divergência `leads_criados` × `get_funnel_health` é ANTERIOR a esta
-- fatia — nasce no `leads_criados`, já em produção. Fica registrada aqui como
-- achado, não corrigida de passagem: mexer na coorte do `leads_criados` move
-- número que o cliente já vê, e isso é decisão de produto, não de porte.
--
-- POR QUE UM LEAF COMPARTILHADO
--
-- `leads_avaliados`, `leads_nao_avaliados` e `boas_avaliacoes` são a MESMA
-- consulta com um predicado diferente sobre a mesma coluna derivada. Três leaves
-- de ~90 linhas cada seriam três lugares para o filtro de coorte divergir com o
-- tempo — e divergência de coorte entre medidas irmãs é justamente o que quebra
-- a soma. O critério entra como parâmetro de conjunto fechado, validado no
-- corpo: valor fora dos três levanta exceção, não devolve contagem errada.
--
-- As outras duas medidas chegam nas migrations seguintes e reusam este leaf.
--
-- ROLLBACK pareado: rollback/20270811130000_metric_leads_avaliados.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('leads_avaliados', 'Leads avaliados', 'count', 'entradas',
   'Leads da janela com qualificação atribuída, final ou pré. Mesma coorte de Leads criados.', 32)
ON CONFLICT (id) DO NOTHING;

-- Os mesmos cinco recortes de `leads_criados`: é a mesma coorte, com um filtro
-- a mais. Oferecer menos aqui faria a medida derivada cortar menos que a base.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('leads_avaliados', 'total'),
  ('leads_avaliados', 'origem'),
  ('leads_avaliados', 'tag'),
  ('leads_avaliados', 'produto'),
  ('leads_avaliados', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('leads_avaliados', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — LEAF COMPARTILHADO DA FAMÍLIA "QUALIDADE DE LEAD"
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_leads_qualidade(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text,
  p_filters jsonb, p_criterio text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint;
BEGIN
  -- Conjunto fechado, verificado. Sem isto, um critério digitado errado numa
  -- migration futura cairia em "nenhum predicado casou" e devolveria a coorte
  -- inteira como se fosse a fatia — número maior, plausível, e errado.
  IF p_criterio NOT IN ('avaliados', 'nao_avaliados', 'bons') THEN
    RAISE EXCEPTION 'unknown criterio % for leads_qualidade', p_criterio
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_base_count
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
    AND public._metric_qualidade_casa(
          COALESCE(l.qualification_tier, l.pre_qualification_tier), p_criterio)
    AND ((p_filters->>'member_id')  IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')     IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id')     IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
           WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
    AND ((p_filters->>'product_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
           WHERE lp.lead_id = l.id AND lp.product_id = (p_filters->>'product_id')::uuid));

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'tag' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.tag_id, 'label', COALESCE(g.tag_name, 'Sem tag'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT t.id AS tag_id, t.name AS tag_name, COUNT(*) AS val
      FROM public.leads l
      JOIN public.lead_tags lt ON lt.lead_id = l.id
      JOIN public.tags t ON t.id = lt.tag_id
      WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
        AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
        AND public._metric_qualidade_casa(
              COALESCE(l.qualification_tier, l.pre_qualification_tier), p_criterio)
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY t.id, t.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'produto' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.product_id, 'label', COALESCE(g.product_name, 'Sem produto'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT p.id AS product_id, p.name AS product_name, COUNT(DISTINCT l.id) AS val
      FROM public.leads l
      JOIN public.lead_products lp ON lp.lead_id = l.id
      JOIN public.products p ON p.id = lp.product_id
      WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
        AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
        AND public._metric_qualidade_casa(
              COALESCE(l.qualification_tier, l.pre_qualification_tier), p_criterio)
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY p.id, p.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- origem | tempo. Mesma forma do `_metric_leaf_leads_criados`, incluindo a
    -- ordenação por valor desc, que é invariante do motor e vale para `tempo`
    -- também — quem desenha linha reordena por data antes.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM') ELSE g.bucket_key END,
               'Sem valor'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'origem' THEN l.origin
          WHEN 'tempo'  THEN to_char(COALESCE(l.metrics_period_at, l.created_at) AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        COUNT(*) AS val
      FROM public.leads l
      WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
        AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
        AND public._metric_qualidade_casa(
              COALESCE(l.qualification_tier, l.pre_qualification_tier), p_criterio)
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
        AND ((p_filters->>'tag_id')    IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
               WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
        AND ((p_filters->>'product_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
               WHERE lp.lead_id = l.id AND lp.product_id = (p_filters->>'product_id')::uuid))
      GROUP BY 1
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- Predicado da família, num lugar só. Existe para que os quatro ramos do leaf
-- não carreguem quatro cópias do mesmo CASE — quatro cópias é onde `bons` vira
-- um tier diferente num ramo e ninguém percebe, porque o total continua certo.
CREATE OR REPLACE FUNCTION public._metric_qualidade_casa(
  p_tier public.qualification_tier, p_criterio text
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = 'public'
AS $$
  SELECT CASE p_criterio
    WHEN 'avaliados'     THEN p_tier IS NOT NULL
    WHEN 'nao_avaliados' THEN p_tier IS NULL
    -- 'prata','ouro','diamante' — a mesma lista de `get_funnel_health.bons`.
    -- 'bronze' e 'desqualificado' ficam de fora, como lá.
    WHEN 'bons'          THEN p_tier IN ('prata', 'ouro', 'diamante')
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
    WHEN 'leads_criados'         THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'     THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'        THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'     THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel' THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'       THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
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
-- 4 — GRANTS
-- ===========================================================================
-- CREATE OR REPLACE preserva o proacl existente; reescrever os REVOKEs é o que
-- garante o estado certo num ambiente novo, onde a função nasce do zero e herda
-- o grant nominal do ALTER DEFAULT PRIVILEGES.
--
-- As assinaturas abaixo são conferidas pelo bloco DO da seção 5 via
-- `::regprocedure`. Não é zelo excessivo: a migration anterior desta série
-- errou um `date` na assinatura do despachante e morreu em 42883 no apply.
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_qualidade_casa(public.qualification_tier, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_qualidade_casa(public.qualification_tier, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_qualidade_casa(public.qualification_tier, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_qualidade_casa(public.qualification_tier, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) TO service_role;

-- ===========================================================================
-- 5 — GUARDA QUE ABORTA
-- ===========================================================================
-- Migration verde não prova nada: o grant é concedido pelo banco no CREATE, não
-- pelo SQL acima. E a armadilha tem duas metades independentes — grant herdado
-- de PUBLIC e grant nominal via ALTER DEFAULT PRIVILEGES —, uma escondendo a
-- outra. Só has_function_privilege fecha o item.
DO $guard$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text)'::regprocedure,
    'public._metric_qualidade_casa(public.qualification_tier, text)'::regprocedure,
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

  -- O wrapper público continua acessível: se algum REVOKE vazar para ele, o
  -- Estúdio inteiro para.
  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;
