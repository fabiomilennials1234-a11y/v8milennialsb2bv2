-- Produtor e leitor precisam existir juntos. Histórico sem snapshot fica pendente,
-- jamais recalculado automaticamente com a taxa atual. Carteira continua fora.
CREATE OR REPLACE FUNCTION public.fn_project_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_original public.commissions%ROWTYPE;
  v_rate numeric; v_type public.product_type; v_metadata jsonb;
  v_local timestamp; v_tz text;
BEGIN
  IF NEW.producer IS DISTINCT FROM 'funnel' OR NEW.event_type = 'sale_lost' THEN RETURN NEW; END IF;
  IF NEW.event_type = 'sale_reversed' THEN
    SELECT * INTO v_original FROM public.commissions WHERE sale_event_id=NEW.reversed_event_id
      AND organization_id=NEW.organization_id AND source='sale_event_projection';
    IF NOT FOUND THEN RETURN NEW; END IF;
    INSERT INTO public.commissions(organization_id,team_member_id,amount,type,month,year,paid,sale_event_id,source,rate_percent)
    VALUES(NEW.organization_id,v_original.team_member_id,-v_original.amount,v_original.type,
      v_original.month,v_original.year,false,NEW.id,'sale_event_projection',v_original.rate_percent)
    ON CONFLICT(sale_event_id) DO NOTHING;
    RETURN NEW;
  END IF;
  IF NEW.event_type <> 'sale' OR NEW.sale_responsible_id IS NULL OR NEW.sale_value IS NULL THEN RETURN NEW; END IF;
  IF NEW.adjusts_sale_id IS NOT NULL THEN
    -- Ajustar valor não altera o contrato de remuneração da venda original.
    SELECT * INTO v_original FROM public.commissions WHERE sale_event_id=NEW.adjusts_sale_id
      AND organization_id=NEW.organization_id AND team_member_id=NEW.sale_responsible_id AND source='sale_event_projection';
    IF NOT FOUND THEN RETURN NEW; END IF;
    v_rate:=v_original.rate_percent; v_type:=v_original.type;
  ELSE
    -- Importação retroativa exige apuração histórica explícita.
    IF NEW.source='backfill' THEN RETURN NEW; END IF;
    SELECT pe.metadata INTO v_metadata FROM public.pipeline_entries pe
      LEFT JOIN public.pipeline_stage_events pse ON pse.entry_id=pe.id
      WHERE pe.organization_id=NEW.organization_id AND
        (pse.id=NEW.stage_event_id OR (NEW.deal_id IS NOT NULL AND pe.deal_id=NEW.deal_id))
      ORDER BY (pse.id=NEW.stage_event_id) DESC NULLS LAST,pe.id LIMIT 1;
    v_type:=CASE WHEN v_metadata->>'product_type'='projeto' THEN 'projeto'::public.product_type ELSE 'mrr'::public.product_type END;
    SELECT CASE WHEN v_type='projeto' THEN tm.commission_projeto_percent ELSE tm.commission_mrr_percent END
      INTO v_rate FROM public.team_members tm WHERE tm.id=NEW.sale_responsible_id AND tm.organization_id=NEW.organization_id;
  END IF;
  -- Taxa zero é válida; taxa ausente é pendência, nunca um percentual inventado.
  IF v_rate IS NULL OR v_rate::text IN ('NaN','Infinity','-Infinity') OR v_rate < 0 OR v_rate > 100 THEN RETURN NEW; END IF;
  SELECT timezone INTO v_tz FROM public.organizations WHERE id=NEW.organization_id;
  v_local:=NEW.sold_at AT TIME ZONE COALESCE(v_tz,'America/Sao_Paulo');
  INSERT INTO public.commissions(organization_id,team_member_id,amount,type,month,year,paid,sale_event_id,source,rate_percent)
  VALUES(NEW.organization_id,NEW.sale_responsible_id,round(NEW.sale_value*v_rate/100,2),v_type,
    extract(month FROM v_local)::int,extract(year FROM v_local)::int,false,NEW.id,'sale_event_projection',v_rate)
  ON CONFLICT(sale_event_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_project_commission() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_sale_events_project_commission ON public.sale_events;
CREATE TRIGGER trg_sale_events_project_commission AFTER INSERT ON public.sale_events
FOR EACH ROW EXECUTE FUNCTION public.fn_project_commission();

CREATE OR REPLACE FUNCTION public.get_commission_ledger(
  p_org_id uuid, p_period text, p_ref date DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_filter_member_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bounds tstzrange; v_comm_total numeric; v_base_total numeric; v_cnt_total integer; v_by_member jsonb; v_pending integer;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  IF auth.uid() IS NOT NULL AND NOT (COALESCE(public.has_feature_permission('commissions.view_all',p_org_id),false) OR EXISTS (
    SELECT 1 FROM public.master_users m WHERE m.user_id=auth.uid() AND m.is_active AND m.permissions->'all'='true'::jsonb
  )) THEN
    IF p_filter_member_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.team_members WHERE id=p_filter_member_id AND organization_id=p_org_id AND user_id=auth.uid() AND is_active
    ) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  END IF;
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  WITH ledger AS (
    SELECT se.sale_responsible_id AS member_id, c.type AS ptype, c.amount AS amount, c.rate_percent AS rate_percent, se.sale_value AS base_value, (c.id IS NULL) AS pending
    FROM public.sale_events se
    LEFT JOIN public.commissions c ON c.sale_event_id=se.id AND c.organization_id=se.organization_id AND c.source='sale_event_projection'
    WHERE se.organization_id=p_org_id AND se.producer='funnel' AND se.sale_responsible_id IS NOT NULL
      AND se.event_type = 'sale' AND se.sold_at <@ v_bounds
      AND (p_filter_member_id IS NULL OR se.sale_responsible_id = p_filter_member_id)
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
  ),
  member_agg AS (
    SELECT l.member_id,
      COUNT(*) FILTER (WHERE l.pending)::int AS pending_count,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.pending),0) AS pending_revenue,
      COALESCE(SUM(l.amount), 0) AS commission, COALESCE(SUM(l.base_value), 0) AS base_revenue, COUNT(*)::int AS sale_count,
      COALESCE(SUM(l.amount) FILTER (WHERE l.ptype = 'mrr'), 0) AS mrr_commission,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.ptype = 'mrr'), 0) AS mrr_base,
      COUNT(*) FILTER (WHERE l.ptype = 'mrr')::int AS mrr_count,
      CASE WHEN COUNT(DISTINCT l.rate_percent) FILTER (WHERE l.ptype = 'mrr') = 1 THEN min(l.rate_percent) FILTER (WHERE l.ptype = 'mrr') END AS mrr_rate,
      COALESCE(SUM(l.amount) FILTER (WHERE l.ptype = 'projeto'), 0) AS proj_commission,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.ptype = 'projeto'), 0) AS proj_base,
      COUNT(*) FILTER (WHERE l.ptype = 'projeto')::int AS proj_count,
      CASE WHEN COUNT(DISTINCT l.rate_percent) FILTER (WHERE l.ptype = 'projeto') = 1 THEN min(l.rate_percent) FILTER (WHERE l.ptype = 'projeto') END AS proj_rate
    FROM ledger l GROUP BY l.member_id
  )
  SELECT
    COALESCE(SUM(m.pending_count),0)::int, COALESCE(SUM(m.commission), 0), COALESCE(SUM(m.base_revenue), 0), COALESCE(SUM(m.sale_count), 0)::int,
    COALESCE(jsonb_agg(jsonb_build_object(
      'pending_count',m.pending_count,'pending_revenue',m.pending_revenue,
      'member_id', m.member_id, 'commission', m.commission, 'base_revenue', m.base_revenue, 'sale_count', m.sale_count,
      'by_type', jsonb_build_object(
        'mrr', jsonb_build_object('commission', m.mrr_commission, 'base_revenue', m.mrr_base, 'sale_count', m.mrr_count, 'rate_percent', m.mrr_rate),
        'projeto', jsonb_build_object('commission', m.proj_commission, 'base_revenue', m.proj_base, 'sale_count', m.proj_count, 'rate_percent', m.proj_rate)
      )) ORDER BY m.commission DESC, m.base_revenue DESC), '[]'::jsonb)
  INTO v_pending, v_comm_total, v_base_total, v_cnt_total, v_by_member
  FROM member_agg m;

  RETURN jsonb_build_object(
    'projection_status', CASE WHEN v_pending>0 THEN 'pending' ELSE 'ready' END, 'pending_count',v_pending,
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'filter_member_id', p_filter_member_id, 'commission_total', v_comm_total, 'base_revenue_total', v_base_total,
    'sale_count_total', v_cnt_total, 'by_member', v_by_member
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_commission_ledger(uuid,text,date,date,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_commission_ledger(uuid,text,date,date,date,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_commissions_protect_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'commissions.source é imutável (#994): linha manual não vira projeção nem o contrário'
        USING ERRCODE = 'P0001';
    END IF;

    IF OLD.source = 'sale_event_projection'
       AND (NEW.amount          IS DISTINCT FROM OLD.amount
         OR NEW.type            IS DISTINCT FROM OLD.type
         OR NEW.month           IS DISTINCT FROM OLD.month
         OR NEW.year            IS DISTINCT FROM OLD.year
         OR NEW.team_member_id  IS DISTINCT FROM OLD.team_member_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         -- pipe_proposta_id: soft link de conveniência. PODE ir a NULL —
         -- é o RI ON DELETE SET NULL da FK quando a entry morre (sem essa
         -- exceção, deletar um lead com projeção abortaria no guard).
         -- Retargeting pra outra entry continua bloqueado.
         OR (NEW.pipe_proposta_id IS DISTINCT FROM OLD.pipe_proposta_id
             AND NEW.pipe_proposta_id IS NOT NULL)
         OR NEW.sale_event_id   IS DISTINCT FROM OLD.sale_event_id
         OR NEW.rate_percent    IS DISTINCT FROM OLD.rate_percent
         OR NEW.created_at      IS DISTINCT FROM OLD.created_at) THEN
      RAISE EXCEPTION 'comissão projetada é imutável exceto paid (ADR-0017 §6): corrija com estorno + venda nova no caderno'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  -- DELETE: projeção só cai em cascade legítimo. Detecção (padrão #992/#993):
  -- alguma entidade-mãe já não existe. Mães com FK CASCADE em commissions:
  -- sale_events (via lead/org), organizations e team_members — deletar um
  -- membro do time cascateia as comissões dele HOJE; o guard não pode
  -- quebrar esse fluxo vigente.
  IF OLD.source = 'sale_event_projection'
     AND EXISTS (SELECT 1 FROM public.sale_events   WHERE id = OLD.sale_event_id)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id)
     AND EXISTS (SELECT 1 FROM public.team_members  WHERE id = OLD.team_member_id) THEN
    RAISE EXCEPTION 'comissão projetada não pode ser deletada (ADR-0017 §6): só cai em cascade de evento/org/membro'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_commissions_protect_projection() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_commissions_protect_projection ON public.commissions;
CREATE TRIGGER trg_commissions_protect_projection
  BEFORE UPDATE OR DELETE ON public.commissions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_commissions_protect_projection();

-- A UI pode registrar comissão manual, mas não fabricar um snapshot de venda.
-- INVOKER distingue o cliente do produtor DEFINER (dono da função).
CREATE OR REPLACE FUNCTION public.fn_commissions_guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.source='sale_event_projection' AND current_user IN ('anon','authenticated') THEN
    RAISE EXCEPTION 'commission_projection_requires_server' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_commissions_guard_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_commissions_guard_insert BEFORE INSERT ON public.commissions
FOR EACH ROW EXECUTE FUNCTION public.fn_commissions_guard_insert();

-- Apuração histórica explícita: parâmetro de taxa confirmado, evento único e trilha no histórico.
CREATE OR REPLACE FUNCTION public.reconciliar_comissao_historica(
  p_event_id uuid,p_rate numeric,p_type public.product_type,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sale public.sale_events%ROWTYPE; v_existing public.commissions%ROWTYPE; v_id uuid; v_local timestamp; v_tz text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_sale FROM public.sale_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public.assert_org_access(v_sale.organization_id);
  IF NOT (v_sale.organization_id IN (SELECT public.get_my_admin_organization_ids()) OR EXISTS (
    SELECT 1 FROM public.master_users m WHERE m.user_id=auth.uid() AND m.is_active AND m.permissions->'all'='true'::jsonb
  )) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE='42501';
  END IF;
  IF v_sale.event_type<>'sale' OR v_sale.producer<>'funnel' OR v_sale.sale_responsible_id IS NULL OR v_sale.sale_value IS NULL
    OR EXISTS(SELECT 1 FROM public.sale_events WHERE reversed_event_id=v_sale.id AND event_type='sale_reversed') THEN
    RAISE EXCEPTION 'sale_not_eligible' USING ERRCODE='22023';
  END IF;
  IF p_rate IS NULL OR p_rate::text IN ('NaN','Infinity','-Infinity') OR p_rate<0 OR p_rate>100 OR p_type IS NULL
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'historical_rate_and_reason_required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.commissions WHERE sale_event_id=v_sale.id;
  IF FOUND THEN
    IF v_existing.rate_percent IS DISTINCT FROM p_rate OR v_existing.type IS DISTINCT FROM p_type THEN
      RAISE EXCEPTION 'commission_already_reconciled' USING ERRCODE='23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  SELECT timezone INTO v_tz FROM public.organizations WHERE id=v_sale.organization_id;
  v_local:=v_sale.sold_at AT TIME ZONE COALESCE(v_tz,'America/Sao_Paulo');
  INSERT INTO public.commissions(organization_id,team_member_id,amount,type,month,year,paid,sale_event_id,source,rate_percent)
  VALUES(v_sale.organization_id,v_sale.sale_responsible_id,round(v_sale.sale_value*p_rate/100,2),p_type,
    extract(month FROM v_local)::int,extract(year FROM v_local)::int,false,v_sale.id,'sale_event_projection',p_rate) RETURNING id INTO v_id;
  INSERT INTO public.lead_history(organization_id,lead_id,action,description,created_by,metadata,source,entity_type,entity_id)
  VALUES(v_sale.organization_id,v_sale.lead_id,'commission_reconciled','Comissão histórica conferida',auth.uid(),
    jsonb_build_object('sale_event_id',v_sale.id,'commission_id',v_id,'rate_percent',p_rate,'product_type',p_type,'reason',btrim(p_reason)),
    'manual','deal',v_sale.deal_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reconciliar_comissao_historica(uuid,numeric,public.product_type,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_comissao_historica(uuid,numeric,public.product_type,text) TO authenticated;

