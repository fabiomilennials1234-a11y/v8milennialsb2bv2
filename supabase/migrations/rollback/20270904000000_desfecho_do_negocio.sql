-- rollback/20270904000000_desfecho_do_negocio.sql
--
-- Devolve o desfecho para a etapa: `fn_capture_sale_event` volta a escrever no
-- caderno direto, e `deals.outcome` deixa de existir.
--
-- 🔴 LEIA ANTES DE RODAR
--
-- Este rollback NÃO desfaz eventos. `sale_events` é append-only (ADR-0017 §4).
-- Toda venda registrada por ação de workflow enquanto a feature esteve no ar
-- CONTINUA no caderno, e é assim que tem que ser: a venda aconteceu.
--
-- O que se perde é a capacidade de saber que aquele negócio foi ganho — o card
-- está numa etapa comum e `outcome` some. Antes de rodar, veja quem seria
-- afetado, e considere mover esses cards para a etapa terminal do funil (quando
-- houver uma) para que o desfecho continue legível:
--
--   SELECT o.name, d.id, d.title, d.outcome, d.outcome_at, pe.stage_key
--     FROM deals d
--     JOIN organizations o ON o.id = d.organization_id
--     LEFT JOIN pipeline_entries pe ON pe.deal_id = d.id
--    WHERE d.outcome <> 'open' AND d.outcome_source = 'workflow';
--
-- `deals.won` sobrevive e continua correto para os ganhos — o espelho o manteve
-- sincronizado. Os PERDIDOS voltam a ser indistinguíveis de abertos, que é
-- exatamente a ambiguidade que a coluna nova existia para resolver.

-- ===========================================================================
-- 1 — A ETAPA VOLTA A ESCREVER NO CADERNO
-- ===========================================================================
-- Corpo vigente ANTES de 20270904000000.
CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_meta jsonb; v_sale_value numeric; v_currency text;
  v_sale_resp uuid; v_pre_resp uuid; v_stream text; v_original public.sale_events%ROWTYPE;
  v_enabled boolean;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.from_stage_key);
  v_to_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);
  IF v_from_role IS DISTINCT FROM 'won' AND v_to_role IS DISTINCT FROM 'won' AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  IF v_from_role = 'won' AND v_to_role IS DISTINCT FROM 'won' THEN
    SELECT s.* INTO v_original FROM public.sale_events s
    WHERE s.lead_id = NEW.lead_id AND s.pipeline_id = NEW.pipeline_id AND s.event_type = 'sale'
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
    ORDER BY s.sold_at DESC, s.created_at DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
      VALUES
        (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id, 'sale_reversed', v_original.id, now(),
         v_original.sale_value, v_original.currency, v_original.revenue_stream, v_original.sale_responsible_id, v_original.pre_sale_responsible_id, NEW.actor, 'trigger');
    END IF;
  END IF;
  IF (v_to_role = 'won' AND v_from_role IS DISTINCT FROM 'won') OR (v_to_role = 'lost' AND v_from_role IS DISTINCT FROM 'lost') THEN
    SELECT pe.metadata INTO v_meta FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;
    BEGIN
      v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
    EXCEPTION WHEN OTHERS THEN v_sale_value := NULL;
    END;
    v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
    IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'BRL'; END IF;
    SELECT COALESCE(l.sale_responsible_id, l.closer_id), l.pre_sale_responsible_id -- metric-lint-allow: restauração literal do corpo anterior a 20270904000000
      INTO v_sale_resp, v_pre_resp
    FROM public.leads l WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id;

    SELECT o.carteira_emits_revenue_enabled INTO v_enabled
    FROM public.organizations o WHERE o.id = NEW.organization_id;

    IF coalesce(v_enabled, false) THEN
      v_stream := public.metric_revenue_stream(NEW.organization_id, NEW.lead_id, now());
    ELSE
      v_stream := CASE WHEN EXISTS (
          SELECT 1 FROM public.upsell_clients uc WHERE uc.organization_id = NEW.organization_id AND uc.lead_id = NEW.lead_id AND uc.is_active
        ) THEN 'carteira' ELSE 'novo_negocio' END;
    END IF;

    INSERT INTO public.sale_events
      (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
    VALUES
      (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id,
       CASE WHEN v_to_role = 'won' THEN 'sale' ELSE 'sale_lost' END,
       NULL, now(), v_sale_value, v_currency, v_stream, v_sale_resp, v_pre_resp, NEW.actor, 'trigger');
  END IF;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 2 — `valor_em_aberto` volta a filtrar só por etapa
-- ===========================================================================
-- Sem `outcome`, o predicado `d.outcome = 'open'` não compila. Volta ao corpo
-- de 20270903000010.
CREATE OR REPLACE FUNCTION public._metric_leaf_valor_em_aberto(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_scoped boolean;
  v_base_count bigint; v_com_valor bigint;
BEGIN
  IF p_recorte NOT IN ('total', 'etapa', 'pipeline', 'closer', 'origem') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure valor_em_aberto', p_recorte
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  SELECT count(*), count(*) FILTER (WHERE d.value IS NOT NULL AND d.value > 0)
  INTO v_base_count, v_com_valor
  FROM public.pipeline_entries pe
  JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
  LEFT JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    SELECT COALESCE(sum(x.valor), 0) INTO v_val
    FROM (
      SELECT DISTINCT d.id, d.value AS valor
      FROM public.pipeline_entries pe
      JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
      LEFT JOIN public.leads l ON l.id = pe.lead_id
      WHERE pe.organization_id = p_org_id
        AND pe.closed_at IS NULL
        AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    ) x;

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',   g.bucket_key,
           'label', COALESCE(g.bucket_label, 'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN pe.pipeline_id::text
        WHEN 'etapa'    THEN pe.pipeline_id::text || ':' || pe.stage_key
        WHEN 'closer'   THEN d.owner_id::text
        WHEN 'origem'   THEN l.origin
      END AS bucket_key,
      CASE p_recorte
        WHEN 'pipeline' THEN pip.name
        WHEN 'etapa'    THEN public._stage_bucket_label(
                               p_org_id, pe.pipeline_id, pe.stage_key, v_scoped)
        WHEN 'closer'   THEN COALESCE(tm.name, 'Sem responsável')
        WHEN 'origem'   THEN l.origin
      END AS bucket_label,
      COALESCE(sum(d.value), 0) AS val
    FROM public.pipeline_entries pe
    JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
    LEFT JOIN public.leads l ON l.id = pe.lead_id
    LEFT JOIN public.team_members tm ON tm.id = d.owner_id
    LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
    'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
END;
$$;

-- ===========================================================================
-- 3 — TRIGGERS, FUNÇÕES E COLUNAS
-- ===========================================================================
DROP TRIGGER IF EXISTS trg_deal_outcome_para_caderno ON public.deals;
DROP TRIGGER IF EXISTS trg_deals_espelha_outcome ON public.deals;

DROP FUNCTION IF EXISTS public.fn_deal_outcome_para_caderno();
DROP FUNCTION IF EXISTS public.fn_deals_espelha_outcome();
DROP FUNCTION IF EXISTS public.garantir_negocio_da_entrada(uuid);
DROP FUNCTION IF EXISTS public._registrar_desfecho_no_caderno(uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, text);

DROP INDEX IF EXISTS public.idx_deals_outcome_org;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_outcome_check;
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_outcome_source_check;
ALTER TABLE public.deals
  DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS outcome_at,
  DROP COLUMN IF EXISTS outcome_source;

-- ⚠ `sale_events.deal_id` fica preenchido nos eventos gravados pela feature.
-- Não é limpo de propósito: é informação correta sobre qual negócio foi a
-- venda, e apagá-la seria perder dado por causa de um rollback de schema.
