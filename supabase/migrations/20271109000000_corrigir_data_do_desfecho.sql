-- Editar a data do desfecho ("Vendido em" / "Perdido em") pelo card do negócio.
--
-- ── GANHO ────────────────────────────────────────────────────────────────
-- Já existe `corrigir_venda_ganha` (20271106000020): estorno + venda nova no
-- caderno, pedido da carteira e negócio juntos, com auditoria. A data editada
-- pelo bloco delega para ela com o valor que o negócio JÁ tem — o servidor
-- escolhe o valor, a tela só manda a data.
--
-- ── PERDIDO ──────────────────────────────────────────────────────────────
-- Perda grava `sale_events.sale_lost` com `sold_at = now()`, e é ESSA data que
-- as métricas de perda leem (`negocios_perdidos`, `valor_perdido`, Oráculo,
-- `get_sales_metrics`). Mexer só em `deals.outcome_at` deixaria o card dizendo
-- uma data e o relatório outra. O caderno é append-only (ADR-0017), então a
-- correção é o mesmo par da venda: estorno do `sale_lost` + `sale_lost` novo
-- na data certa, ligados por `adjusts_sale_id`.
--
-- Para o par existir:
--   1. `sale_adjustment_kind` passa a aceitar `sale_lost`;
--   2. `fn_sale_events_force_sold_at` aceita ajuste de `sale_lost`, exige que o
--      ajuste seja do MESMO tipo (ou o estorno) e deixa o `deal_id` NULL do
--      original ser preenchido (87% dos `sale_lost` nasceram sem ele, pelo
--      caminho da etapa) — nunca trocado;
--   3. os 5 leitores de `sale_lost` que não olhavam estorno passam a olhar.
--      Hoje existem 0 `sale_lost` estornados em prod (medido 08/10): nenhum
--      número atual muda. Corpos copiados de prod em 08/10, uma linha a mais.
--
-- O estorno do `sale_lost` leva `adjusts_sale_id`, e por isso NÃO dispara
-- `trg_carteira_admite_venda` (WHEN adjusts_sale_id IS NULL) — sem isso o
-- estorno de uma perda podia desativar o cliente na carteira.
--
-- Casamento negócio → `sale_lost`: `deal_id` primeiro; senão o do mesmo lead
-- com `sold_at` a menos de 5 min do `outcome_at` (a perda e o evento nascem na
-- mesma transação). Medido em prod: 1275 casam 1, 4 casam vários (vale o mais
-- próximo), 555 não têm evento — esses mudam só a data do negócio, e a função
-- devolve `metric_event_corrected = false`.
BEGIN;

CREATE TABLE public.deal_outcome_date_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome = 'lost'),
  original_event_id uuid REFERENCES public.sale_events(id),
  replacement_event_id uuid REFERENCES public.sale_events(id),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  before_at timestamptz,
  after_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_outcome_date_corrections_deal_idx
  ON public.deal_outcome_date_corrections(organization_id, deal_id, created_at DESC);
ALTER TABLE public.deal_outcome_date_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_outcome_date_corrections_read ON public.deal_outcome_date_corrections FOR SELECT TO authenticated
USING ((public.is_master_user() OR organization_id IN (SELECT public.get_my_organization_ids()))
  AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_outcome_date_corrections.deal_id
    AND d.organization_id = deal_outcome_date_corrections.organization_id
    AND public.can_link_or_read_lead(d.source_lead_id, d.organization_id)));
REVOKE ALL ON public.deal_outcome_date_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deal_outcome_date_corrections TO authenticated;

-- Afrouxa só o tipo: `sale_lost` entra na lista. NOT VALID + VALIDATE separa o
-- lock curto da troca do scan de validação.
ALTER TABLE public.sale_events DROP CONSTRAINT sale_adjustment_kind;
ALTER TABLE public.sale_events ADD CONSTRAINT sale_adjustment_kind CHECK (
  adjusts_sale_id IS NULL OR (event_type IN ('sale', 'sale_reversed', 'sale_lost') AND deal_id IS NOT NULL)
) NOT VALID;
ALTER TABLE public.sale_events VALIDATE CONSTRAINT sale_adjustment_kind;

CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_original public.sale_events%ROWTYPE;
BEGIN
  IF NEW.adjusts_sale_id IS NOT NULL THEN
    SELECT * INTO v_original FROM public.sale_events WHERE id = NEW.adjusts_sale_id;
    IF NOT FOUND OR v_original.event_type NOT IN ('sale', 'sale_lost')
       OR NEW.event_type NOT IN (v_original.event_type, 'sale_reversed')
       OR v_original.organization_id IS DISTINCT FROM NEW.organization_id
       -- `sale_lost` antigo pode não ter negócio: o ajuste PREENCHE, nunca troca.
       OR (v_original.deal_id IS DISTINCT FROM NEW.deal_id
           AND NOT (v_original.event_type = 'sale_lost' AND v_original.deal_id IS NULL))
       OR v_original.lead_id IS DISTINCT FROM NEW.lead_id
       OR (NEW.event_type = 'sale_reversed' AND NEW.reversed_event_id IS DISTINCT FROM v_original.id) THEN
      RAISE EXCEPTION 'invalid_sale_adjustment' USING ERRCODE = '22023';
    END IF;
    IF NEW.event_type <> v_original.event_type OR
       COALESCE(current_setting('torque.sale_correction_event', true), '') <> NEW.id::text THEN
      NEW.sold_at := v_original.sold_at;
    END IF;
  ELSIF NEW.source <> 'backfill' AND NEW.producer <> 'carteira' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_sale_events_force_sold_at() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.corrigir_data_do_desfecho(
  p_deal_id uuid, p_expected_updated_at timestamptz, p_date date, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_old public.sale_events%ROWTYPE;
  v_reversal public.sale_events%ROWTYPE;
  v_replacement public.sale_events%ROWTYPE;
  v_timezone text;
  v_at timestamptz;
  v_value numeric;
  v_found boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_org_member(v_deal.organization_id);
  IF NOT COALESCE(public.is_master_user(), false) AND NOT EXISTS (
    SELECT 1 FROM public.team_members m WHERE m.user_id = auth.uid()
      AND m.organization_id = v_deal.organization_id AND m.is_active AND m.role IN ('admin','member')
  ) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(public.can_link_or_read_lead(v_deal.source_lead_id, v_deal.organization_id), false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  -- Ganho: um caminho só para venda. O valor é o que o negócio já tem — o dos
  -- produtos quando há produtos, para não esbarrar em `sale_value_from_items`.
  IF v_deal.outcome = 'won' THEN
    SELECT round(sum(total), 2) INTO v_value FROM public.deal_items WHERE deal_id = v_deal.id;
    RETURN public.corrigir_venda_ganha(p_deal_id, p_expected_updated_at,
      COALESCE(v_value, v_deal.value), p_date, p_reason);
  END IF;

  IF v_deal.outcome IS DISTINCT FROM 'lost' THEN RAISE EXCEPTION 'deal_not_closed' USING ERRCODE = '22023'; END IF;
  IF p_expected_updated_at IS NULL OR v_deal.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'deal_state_changed' USING ERRCODE = 'PT409';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'correction_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(timezone,''),'America/Sao_Paulo') INTO v_timezone
    FROM public.organizations WHERE id = v_deal.organization_id;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE v_timezone)::date THEN
    RAISE EXCEPTION 'invalid_outcome_date' USING ERRCODE = '22023';
  END IF;

  -- Mesmo dia conserva a hora; outro dia usa meio-dia na org (igual à venda).
  v_at := CASE WHEN v_deal.outcome_at IS NOT NULL AND p_date = (v_deal.outcome_at AT TIME ZONE v_timezone)::date
    THEN v_deal.outcome_at ELSE (p_date + time '12:00') AT TIME ZONE v_timezone END;
  IF v_deal.outcome_at IS NOT DISTINCT FROM v_at AND v_deal.closed_at IS NOT DISTINCT FROM v_at THEN
    RETURN jsonb_build_object('deal_id', v_deal.id, 'changed', false);
  END IF;

  SELECT s.* INTO v_old FROM public.sale_events s
   WHERE s.organization_id = v_deal.organization_id AND s.event_type = 'sale_lost'
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
     AND (s.deal_id = v_deal.id
       OR (s.deal_id IS NULL AND s.lead_id = v_deal.source_lead_id AND v_deal.outcome_at IS NOT NULL
           AND abs(extract(epoch FROM s.sold_at - v_deal.outcome_at)) < 300))
   ORDER BY (s.deal_id IS NOT DISTINCT FROM v_deal.id) DESC,
            abs(extract(epoch FROM s.sold_at - COALESCE(v_deal.outcome_at, s.sold_at))), s.created_at DESC
   LIMIT 1
   FOR UPDATE;
  v_found := FOUND;

  IF v_found THEN
    v_reversal := v_old;
    v_reversal.id := gen_random_uuid(); v_reversal.event_type := 'sale_reversed';
    v_reversal.reversed_event_id := v_old.id; v_reversal.adjusts_sale_id := v_old.id; v_reversal.deal_id := v_deal.id;
    v_reversal.created_at := now(); v_reversal.actor := auth.uid(); v_reversal.source := 'ui'; v_reversal.stage_event_id := NULL;
    v_reversal.origin_record_id := NULL;
    v_replacement := v_old;
    v_replacement.id := gen_random_uuid(); v_replacement.adjusts_sale_id := v_old.id; v_replacement.deal_id := v_deal.id;
    v_replacement.sold_at := v_at;
    v_replacement.created_at := now(); v_replacement.actor := auth.uid(); v_replacement.source := 'ui'; v_replacement.stage_event_id := NULL;
    v_replacement.origin_record_id := NULL;
    PERFORM set_config('torque.sale_correction_event', v_replacement.id::text, true);
    INSERT INTO public.sale_events SELECT * FROM unnest(ARRAY[v_reversal, v_replacement]);
    PERFORM set_config('torque.sale_correction_event', '', true);
  END IF;

  UPDATE public.deals SET closed_at = v_at, outcome_at = v_at, updated_at = clock_timestamp() WHERE id = v_deal.id;
  INSERT INTO public.deal_outcome_date_corrections(organization_id, deal_id, outcome, original_event_id,
    replacement_event_id, actor_id, reason, before_at, after_at)
  VALUES (v_deal.organization_id, v_deal.id, 'lost', CASE WHEN v_found THEN v_old.id END,
    CASE WHEN v_found THEN v_replacement.id END, auth.uid(), btrim(p_reason), v_deal.outcome_at, v_at);
  RETURN jsonb_build_object('deal_id', v_deal.id, 'outcome_at', v_at, 'changed', true,
    'metric_event_corrected', v_found);
END;
$$;
REVOKE ALL ON FUNCTION public.corrigir_data_do_desfecho(uuid,timestamptz,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_data_do_desfecho(uuid,timestamptz,date,text) TO authenticated;

-- ── Leitores de `sale_lost` passam a respeitar o estorno ──────────────────
CREATE OR REPLACE FUNCTION public.get_sales_metrics(p_org_id uuid, p_period text, p_ref date DEFAULT NULL::date, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_pipeline_id uuid DEFAULT NULL::uuid, p_filter_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bounds tstzrange;
  v_rev_total numeric; v_rev_novo numeric; v_rev_carteira numeric;
  v_cnt_won integer; v_cnt_novo integer; v_cnt_carteira integer; v_cnt_lost integer;
  v_by_closer jsonb; v_unattr_rev numeric; v_unattr_cnt integer;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  SELECT
    COALESCE(SUM(w.sale_value), 0),
    COALESCE(SUM(w.sale_value) FILTER (WHERE w.revenue_stream = 'novo_negocio'), 0),
    COALESCE(SUM(w.sale_value) FILTER (WHERE w.revenue_stream = 'carteira'), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE w.revenue_stream = 'novo_negocio'),
    COUNT(*) FILTER (WHERE w.revenue_stream = 'carteira')
  INTO v_rev_total, v_rev_novo, v_rev_carteira, v_cnt_won, v_cnt_novo, v_cnt_carteira
  FROM public.sale_events w
  WHERE w.organization_id = p_org_id AND w.event_type = 'sale' AND w.sold_at <@ v_bounds
    AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
    AND (p_filter_member_id IS NULL OR w.sale_responsible_id = p_filter_member_id)
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id);

  SELECT COUNT(*) INTO v_cnt_lost
  FROM public.sale_events se
  WHERE se.organization_id = p_org_id AND se.event_type = 'sale_lost' AND se.sold_at <@ v_bounds
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
    AND (p_pipeline_id IS NULL OR se.pipeline_id = p_pipeline_id)
    AND (p_filter_member_id IS NULL OR se.sale_responsible_id = p_filter_member_id);

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('member_id', g.sale_responsible_id, 'revenue', g.revenue, 'sale_count', g.sale_count)
      ORDER BY g.revenue DESC, g.sale_count DESC) FILTER (WHERE g.sale_responsible_id IS NOT NULL), '[]'::jsonb),
    COALESCE(SUM(g.revenue) FILTER (WHERE g.sale_responsible_id IS NULL), 0),
    COALESCE(SUM(g.sale_count) FILTER (WHERE g.sale_responsible_id IS NULL), 0)::int
  INTO v_by_closer, v_unattr_rev, v_unattr_cnt
  FROM (
    SELECT w.sale_responsible_id, COALESCE(SUM(w.sale_value), 0) AS revenue, COUNT(*)::int AS sale_count
    FROM public.sale_events w
    WHERE w.organization_id = p_org_id AND w.event_type = 'sale' AND w.sold_at <@ v_bounds
      AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
      AND (p_filter_member_id IS NULL OR w.sale_responsible_id = p_filter_member_id)
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
    GROUP BY w.sale_responsible_id
  ) g;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'pipeline_id', p_pipeline_id, 'filter_member_id', p_filter_member_id,
    'revenue_total', v_rev_total,
    'revenue_by_stream', jsonb_build_object(
      'novo_negocio', jsonb_build_object('revenue', v_rev_novo, 'sale_count', v_cnt_novo),
      'carteira', jsonb_build_object('revenue', v_rev_carteira, 'sale_count', v_cnt_carteira)),
    'won_count', v_cnt_won, 'lost_count', v_cnt_lost,
    'ticket_medio', CASE WHEN v_cnt_won > 0 THEN round(v_rev_total / v_cnt_won, 2) ELSE NULL END,
    'by_closer', v_by_closer,
    'unattributed', jsonb_build_object('revenue', v_unattr_rev, 'sale_count', v_unattr_cnt)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.oraculo_metricas(p_organization_id uuid, p_team_member_id uuid, p_periodo_dias integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  leads_periodo AS (
    SELECT count(*) AS n
    FROM public.leads l, periodo p
    WHERE l.organization_id = p_organization_id
      AND l.created_at >= p.desde
      AND l.deleted_at IS NULL
      AND coalesce(l.is_shadow, false) = false
      AND (
        p_team_member_id IS NULL
        OR l.responsible_id = p_team_member_id
        OR l.sdr_id         = p_team_member_id
        OR l.closer_id      = p_team_member_id
      )
  ),
  vendas AS (
    SELECT se.sale_value
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale'
      AND se.sold_at >= p.desde
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id
      )
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id     = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
      )
  ),
  perdas AS (
    SELECT count(*) AS n
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale_lost'
      AND se.sold_at >= p.desde
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id     = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
      )
  )
  SELECT jsonb_build_object(
    'escopo',           CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'periodo_dias',     greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    'leads_criados',    (SELECT n FROM leads_periodo),
    'vendas',           (SELECT count(*) FROM vendas),
    'perdas',           (SELECT n FROM perdas),
    'receita',          (SELECT coalesce(sum(sale_value), 0) FROM vendas),
    'ticket_medio',     (SELECT round(coalesce(avg(sale_value), 0), 2) FROM vendas),
    'conversao_lead_venda',
      CASE WHEN (SELECT n FROM leads_periodo) > 0
           THEN round((SELECT count(*) FROM vendas)::numeric / (SELECT n FROM leads_periodo), 4)
           ELSE NULL END
  );
$function$;

CREATE OR REPLACE FUNCTION public.oraculo_ranking(p_organization_id uuid, p_periodo_dias integer, p_limite integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  vendas AS (
    SELECT se.sale_responsible_id AS tm, se.sale_value
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale'
      AND se.sold_at >= p.desde
      AND se.sale_responsible_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id
      )
  ),
  perdas AS (
    SELECT se.sale_responsible_id AS tm, count(*) AS n
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale_lost'
      AND se.sold_at >= p.desde
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
      AND se.sale_responsible_id IS NOT NULL
    GROUP BY 1
  ),
  consolidado AS (
    SELECT
      tm.id   AS team_member_id,
      tm.name AS pessoa,
      (SELECT count(*)                     FROM vendas v WHERE v.tm = tm.id) AS vendas,
      (SELECT coalesce(sum(v.sale_value),0) FROM vendas v WHERE v.tm = tm.id) AS receita,
      (SELECT coalesce(pd.n, 0)            FROM perdas pd WHERE pd.tm = tm.id) AS perdas
    FROM public.team_members tm
    WHERE tm.organization_id = p_organization_id
      AND tm.is_active
  )
  SELECT jsonb_build_object(
    'escopo',       'organizacao',
    'periodo_dias', greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    -- Quem não vendeu nem perdeu no período NÃO entra: conta de teste apareceria
    -- como o pior desempenho da organização todo dia, para sempre.
    'pessoas', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.receita DESC, x.vendas DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'pessoa',  pessoa,
          'vendas',  vendas,
          'receita', receita,
          'perdas',  perdas
        ) AS x, receita, vendas
        FROM consolidado
        WHERE vendas > 0 OR perdas > 0
        ORDER BY receita DESC, vendas DESC
        LIMIT greatest(1, least(coalesce(p_limite, 20), 50))
      ) x
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.oraculo_perdas(p_organization_id uuid, p_team_member_id uuid, p_periodo_dias integer, p_limite integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  perdidas AS (
    SELECT se.id, se.sale_value, se.sale_responsible_id, se.sold_at
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale_lost'
      AND se.sold_at >= p.desde
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id     = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
      )
  )
  SELECT jsonb_build_object(
    'escopo',        CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'periodo_dias',  greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    'perdas',        (SELECT count(*) FROM perdidas),
    'valor_perdido', (SELECT coalesce(sum(sale_value), 0) FROM perdidas),
    -- O motivo não é omitido em silêncio: o Oráculo precisa saber que a
    -- dimensão não existe, senão o modelo preenche o buraco sozinho.
    'motivo_disponivel', false,
    'motivo_observacao',
      'Motivo de perda não é registrado nesta base: nenhum dos negócios perdidos tem motivo preenchido. Responda quanto e onde se perdeu, e diga que o porquê não está registrado.',
    'por_pessoa', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.perdas DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'pessoa', tm.name,
          'perdas', count(*),
          'valor',  coalesce(sum(pd.sale_value), 0)
        ) AS x, count(*) AS perdas
        FROM perdidas pd
        JOIN public.team_members tm ON tm.id = pd.sale_responsible_id
        GROUP BY tm.name
        ORDER BY count(*) DESC
        LIMIT greatest(1, least(coalesce(p_limite, 20), 50))
      ) x
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.oraculo_person_profile_at(p_organization_id uuid, p_subject_team_member_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '10s'
AS $function$
  WITH dates AS (
    SELECT date_trunc('week', p_as_of::timestamp)::date AS this_week
  ), bounds AS (
    SELECT
      public.metric_period_bounds(p_organization_id, 'range', NULL,
        d.this_week - 98, d.this_week - 42 - 1) AS baseline_range,
      public.metric_period_bounds(p_organization_id, 'range', NULL,
        d.this_week - 42, d.this_week - 14 - 1) AS current_range
    FROM dates d
  ), outcomes AS (
    SELECT se.sold_at AS occurred_at, x.metric, x.member_id,
      CASE WHEN se.event_type = 'sale' AND reversal.found IS NULL THEN 1 ELSE 0 END AS success,
      CASE WHEN se.event_type = 'sale' AND se.sale_value > 0 AND reversal.found IS NULL
        THEN se.sale_value END AS ticket
    FROM public.sale_events se
    CROSS JOIN LATERAL (VALUES
      ('meetings'::text, se.pre_sale_responsible_id),
      ('sales'::text, se.sale_responsible_id)
    ) x(metric, member_id)
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
      SELECT true AS found FROM public.sale_events r
      WHERE r.organization_id = se.organization_id
        AND r.event_type = 'sale_reversed'
        AND r.reversed_event_id = se.id
      LIMIT 1
    ) reversal ON true
    WHERE se.organization_id = p_organization_id
      AND se.event_type IN ('sale', 'sale_lost')
      AND NOT (se.event_type = 'sale_lost' AND reversal.found IS NOT NULL)
      AND x.member_id IS NOT NULL
      AND (se.sold_at <@ b.baseline_range OR se.sold_at <@ b.current_range)
  ), members AS (
    SELECT tm.id, tm.name, tm.metric_type::text AS declared_metric
    FROM public.team_members tm
    WHERE tm.organization_id = p_organization_id AND tm.is_active
  ), metrics(metric) AS (VALUES ('meetings'::text), ('sales'::text)), rollup AS (
    SELECT m.id, m.name, m.declared_metric, metric.metric,
      count(o.*) FILTER (WHERE o.occurred_at <@ b.current_range)::integer AS current_assignments,
      coalesce(sum(o.success) FILTER (WHERE o.occurred_at <@ b.current_range), 0)::integer AS current_successes,
      count(o.*) FILTER (WHERE o.occurred_at <@ b.baseline_range)::integer AS baseline_assignments,
      coalesce(sum(o.success) FILTER (WHERE o.occurred_at <@ b.baseline_range), 0)::integer AS baseline_successes,
      coalesce(avg(o.ticket) FILTER (WHERE o.ticket IS NOT NULL), 0)::numeric AS average_ticket
    FROM members m CROSS JOIN metrics metric CROSS JOIN bounds b
    LEFT JOIN outcomes o ON o.member_id = m.id AND o.metric = metric.metric
    GROUP BY m.id, m.name, m.declared_metric, metric.metric
  ), metric_ticket AS (
    SELECT metric, coalesce(avg(ticket) FILTER (WHERE ticket IS NOT NULL), 0)::numeric AS average_ticket
    FROM outcomes GROUP BY metric
  ), rates AS (
    SELECT r.id, r.name, r.declared_metric, r.metric,
      r.current_assignments, r.current_successes, r.baseline_assignments, r.baseline_successes,
      coalesce(nullif(r.average_ticket, 0), mt.average_ticket, 0)::numeric AS average_ticket,
      r.current_successes::numeric / nullif(r.current_assignments, 0) AS current_rate,
      r.baseline_successes::numeric / nullif(r.baseline_assignments, 0) AS baseline_rate
    FROM rollup r LEFT JOIN metric_ticket mt USING (metric)
  ), team AS (
    SELECT metric,
      count(*) FILTER (WHERE current_assignments >= 10) AS evaluable_people,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY current_rate)
        FILTER (WHERE current_assignments >= 10) AS median_rate
    FROM rates GROUP BY metric
  ), evaluated AS (
    SELECT r.*, t.evaluable_people, t.median_rate::numeric,
      CASE WHEN t.evaluable_people >= 4 THEN 'team_median'
           WHEN r.baseline_assignments >= 10 THEN 'own_history' END AS comparison_basis,
      CASE WHEN t.evaluable_people >= 4 THEN t.median_rate::numeric
           WHEN r.baseline_assignments >= 10 THEN r.baseline_rate END AS benchmark_rate,
      CASE WHEN r.current_assignments < 10 THEN 'insufficient_volume'
           WHEN t.evaluable_people < 4 AND r.baseline_assignments < 10 THEN 'insufficient_benchmark'
           ELSE 'evaluable' END AS evaluation_status
    FROM rates r JOIN team t USING (metric)
  ), shaped AS (
    SELECT e.*,
      greatest(0, coalesce(e.benchmark_rate, 0) - coalesce(e.current_rate, 0)) AS rate_gap,
      greatest(0, e.current_assignments *
        (coalesce(e.benchmark_rate, 0) - coalesce(e.current_rate, 0)) * e.average_ticket) AS leaked_revenue
    FROM evaluated e
  ), profiles AS (
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'team_member_id', CASE WHEN p_subject_team_member_id IS NULL THEN id END,
      'team_member_name', CASE WHEN p_subject_team_member_id IS NULL THEN name END,
      'subject', CASE WHEN p_subject_team_member_id IS NOT NULL THEN 'self' END,
      'metric', metric,
      'declared_metric', declared_metric,
      'declared_absence', declared_metric = metric AND current_assignments + baseline_assignments = 0,
      'status', evaluation_status,
      'minimum_participation', 10,
      'current_assignments', current_assignments,
      'baseline_assignments', baseline_assignments,
      'current_conversion', round(current_rate, 4),
      'benchmark_conversion', round(benchmark_rate, 4),
      'comparison_basis', comparison_basis,
      'team_sample_size', evaluable_people
    )) ORDER BY name, metric), '[]'::jsonb) AS value
    FROM shaped
    WHERE p_subject_team_member_id IS NULL OR id = p_subject_team_member_id
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY leaked_revenue DESC, id, metric) AS position
    FROM shaped
    WHERE evaluation_status = 'evaluable' AND rate_gap >= 0.05 AND leaked_revenue >= 1000
      AND (p_subject_team_member_id IS NULL OR id = p_subject_team_member_id)
  )
  SELECT jsonb_build_object(
    'status', CASE WHEN EXISTS (SELECT 1 FROM ranked) THEN 'bottleneck' ELSE 'none' END,
    'bottleneck', (SELECT jsonb_strip_nulls(jsonb_build_object(
      'dimension', CASE WHEN p_subject_team_member_id IS NULL THEN 'person' ELSE 'self' END,
      'key', CASE WHEN p_subject_team_member_id IS NULL THEN id::text ELSE 'self' END,
      'label', CASE WHEN p_subject_team_member_id IS NULL THEN name ELSE 'Seu desempenho' END,
      'team_member_id', CASE WHEN p_subject_team_member_id IS NULL THEN id END,
      'team_member_name', CASE WHEN p_subject_team_member_id IS NULL THEN name END,
      'metric', metric, 'current_volume', current_assignments,
      'current_conversion', round(current_rate, 4),
      'baseline_conversion', round(benchmark_rate, 4),
      'comparison_basis', comparison_basis, 'team_sample_size', evaluable_people,
      'rate_gap_pp', round(rate_gap * 100, 2), 'average_ticket', round(average_ticket, 2),
      'estimated_leaked_revenue', round(leaked_revenue, 2)
    )) FROM ranked WHERE position = 1),
    'profiles', (SELECT value FROM profiles),
    'evidence', jsonb_build_object('minimum_participation', 10, 'minimum_team_size', 4)
  );
$function$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.corrigir_data_do_desfecho(uuid,timestamptz,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ganhou EXECUTE numa funcao SECURITY DEFINER';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.corrigir_data_do_desfecho(uuid,timestamptz,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE: a tela nao corrige data';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
