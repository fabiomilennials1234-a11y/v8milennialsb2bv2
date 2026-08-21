-- 20270821130000_metric_coorte_canonica_leads.sql
--
-- SCRUM-368 — "quantos leads entraram" devolve número diferente conforme a
-- tela. Esta migration escolhe UMA coorte e faz o motor obedecê-la.
--
-- O QUE FOI MEDIDO EM PRODUÇÃO (2026-08-21, pg_get_functiondef)
--
-- Não são duas leituras divergentes, como o card supunha. São TRÊS:
--
--   função                       exclui sombra   exclui excluded_from_metrics
--   get_funnel_health                 não                  SIM
--   get_dashboard_metrics             SIM                  não
--   _metric_leaf_leads_criados        não                  não
--
-- Cada superfície responde "quantos leads entraram" com um conjunto diferente.
-- 54.784 leads vivos, 93 sombra, e a marca `excluded_from_metrics` alcançando
-- 698 na medição de 2026-08-11.
--
-- DECISÃO DO CTO (2026-08-21) — a coorte canônica EXCLUI os marcados
--
--     coorte = deleted_at IS NULL
--              AND NOT is_shadow
--              AND NOT lead_excluded_from_metrics(id, org)
--
-- Quem se alinha é o MOTOR, não as telas legadas: a marca de exclusão existe
-- porque alguém decidiu que aquele lead não conta (import de teste, dado sujo),
-- e mover o outro lado mudaria número que o cliente já vê hoje. O Estúdio ainda
-- não está na frente de ninguém — é o lado barato de alinhar.
--
-- `is_shadow` entrou na canônica por leitura direta do comentário da coluna:
-- "criado automaticamente pelo copilot, INVISÍVEL nos pipes até ser promovido".
-- Lead que o usuário não enxerga não é lead que entrou. `get_dashboard_metrics`
-- e `_metric_leaf_leads_sem_dono` já o excluíam por conta própria; o que esta
-- migration faz é parar de deixar isso a critério de cada leaf.
--
-- POR QUE UMA FUNÇÃO, E NÃO O PREDICADO REPETIDO
--
-- O predicado aparecia em ONZE lugares nos três leaves de coorte de lead — uma
-- vez por recorte, em cada um. Onze cópias são onze chances de divergir na
-- próxima edição, e divergência de coorte entre medidas irmãs é o defeito que
-- quebra a identidade que o Estúdio promete:
--
--     leads_avaliados + leads_nao_avaliados = leads_criados
--
-- `_metric_lead_na_coorte` passa a ser o único lugar onde a coorte é escrita.
-- O pgTAP pareado prova a identidade E prova que nenhum dos três leaves fala de
-- `public.leads` sem passar por ela.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não toca `get_funnel_health` nem `get_dashboard_metrics`. As duas seguem com
-- a coorte que têm; alinhar as telas legadas é mudança de número na frente do
-- cliente e pertence a uma fatia própria, com aviso. Aqui o alvo é o motor.
--
-- Não toca os leaves ancorados em NEGÓCIO (`_metric_leaf_sales`,
-- `_metric_leaf_sales_lost`, `_metric_leaf_coorte_etapa`): a coorte deles é de
-- venda, não de entrada de lead. Aplicar o predicado ali sem medir mudaria
-- receita, que é dinheiro (ADR-0017 §1).
--
-- ROLLBACK pareado: rollback/20270821130000_metric_coorte_canonica_leads.sql

-- ===========================================================================
-- 1 — A COORTE CANÔNICA
-- ===========================================================================
--
-- Recebe as colunas em vez do registro inteiro de propósito: assinatura estável
-- não muda quando `leads` ganha coluna, e o plano continua inlinável.
CREATE OR REPLACE FUNCTION public._metric_lead_na_coorte(
  p_deleted_at timestamptz,
  p_is_shadow boolean,
  p_lead_id uuid,
  p_org_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT p_deleted_at IS NULL
     AND COALESCE(p_is_shadow, false) = false
     AND NOT public.lead_excluded_from_metrics(p_lead_id, p_org_id);
$$;

COMMENT ON FUNCTION public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid) IS
  'SCRUM-368 — coorte canônica de LEAD do motor de métricas: vivo, não-sombra e não marcado como fora das métricas. Único lugar onde este predicado é escrito; os leaves de entrada o chamam.';

REVOKE EXECUTE ON FUNCTION public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid)
  TO service_role;

-- ===========================================================================
-- 2 — OS TRÊS LEAVES DE ENTRADA, AGORA FALANDO PELA CANÔNICA
-- ===========================================================================
-- Corpos idênticos aos vigentes, com uma diferença: onde havia
-- `l.deleted_at IS NULL` (e, no `leads_sem_dono`, também o filtro próprio de
-- sombra), agora há a chamada única.
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
    AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
      WHERE l.organization_id = p_org_id AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
      WHERE l.organization_id = p_org_id AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
      WHERE l.organization_id = p_org_id AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
    AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
      WHERE l.organization_id = p_org_id AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
      WHERE l.organization_id = p_org_id AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
      WHERE l.organization_id = p_org_id AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
    AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
        AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
        AND public._metric_lead_na_coorte(l.deleted_at, l.is_shadow, l.id, p_org_id)
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
-- ===========================================================================
-- 3 — GUARDA DE GRANT
-- ===========================================================================
-- Os três leaves foram reescritos: `CREATE OR REPLACE` preserva os grants, mas
-- provar é mais barato que descobrir em produção que o motor parou.
DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_lead_na_coorte(timestamptz, boolean, uuid, uuid)'::regprocedure,
    'public._metric_leaf_leads_criados(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text)'::regprocedure,
    'public._metric_leaf_leads_sem_dono(uuid, text, jsonb)'::regprocedure
  ];
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
