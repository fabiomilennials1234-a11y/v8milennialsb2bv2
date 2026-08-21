-- ===========================================================================
-- ROLLBACK — 20270821130000_metric_coorte_canonica_leads.sql (SCRUM-368)
-- ===========================================================================
-- Ordem: os leaves PRIMEIRO (param de chamar), depois a função da coorte. O
-- inverso deixaria três funções apontando para uma função inexistente entre
-- dois statements.
--
-- Os corpos abaixo são os vigentes ANTES da fatia, copiados de
-- 20260723100100 (criados), 20270811130000 (qualidade) e 20270812010000
-- (sem_dono) — inclusive o filtro próprio de sombra do último, que a canônica
-- tinha absorvido.
--
-- ⚠ Reverter aqui REINTRODUZ a divergência de coorte medida em 2026-08-21:
-- `leads_criados` volta a contar sombra e lead marcado como fora das métricas,
-- e a identidade `avaliados + nao_avaliados = leads_criados` volta a fechar
-- sobre a coorte errada. Não é um rollback neutro; é uma troca de defeito.
-- ===========================================================================

-- _metric_leaf_leads_criados — corpo de 20260723100100_fn_metric_measure_engine.sql
CREATE OR REPLACE FUNCTION public._metric_leaf_leads_criados(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
    AND ((p_filters->>'member_id')  IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')     IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id')     IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
           WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
    AND ((p_filters->>'product_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
           WHERE lp.lead_id = l.id AND lp.product_id = (p_filters->>'product_id')::uuid));

  IF p_recorte = 'total' THEN
    v_val := v_base_count;
    RETURN jsonb_build_object('value', v_val, 'series', NULL,
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
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY p.id, p.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- origem | tempo
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

-- _metric_leaf_leads_qualidade — corpo de 20270811130000_metric_leads_avaliados.sql
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

-- _metric_leaf_leads_sem_dono — corpo de 20270812010000_metric_leads_sem_responsavel.sql
CREATE OR REPLACE FUNCTION public._metric_leaf_leads_sem_dono(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND COALESCE(l.is_shadow, false) = false
    AND l.responsible_id IS NULL
    AND l.sale_responsible_id IS NULL
    AND l.pre_sale_responsible_id IS NULL
    AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id') IS NULL OR EXISTS (
          SELECT 1 FROM public.lead_tags lt
          WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid));

  IF p_recorte = 'total' THEN
    v_val := v_base_count;
    RETURN jsonb_build_object('value', v_val, 'series', NULL,
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
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND COALESCE(l.is_shadow, false) = false
        AND l.responsible_id IS NULL
        AND l.sale_responsible_id IS NULL
        AND l.pre_sale_responsible_id IS NULL
        AND ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY t.id, t.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- origem
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(g.bucket_key, 'Sem origem'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT l.origin AS bucket_key, COUNT(*) AS val
      FROM public.leads l
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND COALESCE(l.is_shadow, false) = false
        AND l.responsible_id IS NULL
        AND l.sale_responsible_id IS NULL
        AND l.pre_sale_responsible_id IS NULL
        AND ((p_filters->>'tag_id') IS NULL OR EXISTS (
              SELECT 1 FROM public.lead_tags lt
              WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
      GROUP BY l.origin
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- A coorte canônica deixa de existir. Só depois dos três acima.
DROP FUNCTION IF EXISTS public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid);
