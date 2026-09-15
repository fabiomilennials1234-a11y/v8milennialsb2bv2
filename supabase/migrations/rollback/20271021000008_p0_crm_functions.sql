-- Snapshot de funções de produção em 14/09/2026 antes do P0.
-- Reverte os caminhos de leitura/criação; preserva comissões já auditadas e request_hash.
-- Parar rollout do frontend antes de usar. Não executado automaticamente.
BEGIN;
DROP TRIGGER IF EXISTS trg_sale_events_project_commission ON public.sale_events;
CREATE OR REPLACE FUNCTION public.api_create_deal(p_org uuid, p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_title text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_source text DEFAULT 'api'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_endpoint constant text := 'POST /deals';
  v_lead_org uuid;
  v_existente uuid;
  v_deal_id  uuid;
  v_aberto   record;
  v_row      public.deals%ROWTYPE;
  v_aviso    jsonb := NULL;
  v_pip      public.pipelines%ROWTYPE;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- ── Recorte por inquilino, ANTES de qualquer coisa ────────────────────────
  -- A função roda como DEFINER e é chamada por service_role: RLS não protege
  -- este caminho. Se o Lead não é desta organização, a chave não pode alcançá-lo.
  SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_lead_org IS NULL OR v_lead_org <> p_org THEN
    RAISE EXCEPTION 'Lead % não encontrado nesta organização.', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Replay ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT k.resource_id INTO v_existente
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row FROM public.deals WHERE id = v_existente AND deleted_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'replayed',
          'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                                     'value', v_row.value, 'source', v_row.source));
      END IF;
    END IF;
  END IF;

  -- Erra alto DEPOIS do replay (retry idempotente devolve o Negócio mesmo se o
  -- funil sumiu no meio-tempo — comportamento herdado) e ANTES do aviso e da
  -- abertura: funil inexistente não abre nada nem conta aviso.
  v_pip := public.fn_resolver_funil(p_org, p_pipe);

  -- ── O aviso, medido ANTES de abrir ────────────────────────────────────────
  -- Depois de abrir, o Negócio novo já estaria na contagem e o aviso viria
  -- sempre. A pergunta é "ele JÁ tinha um aberto aqui?". Ancorado por
  -- pipeline_id: funciona igual para funil de sistema e personalizado.
  SELECT d.id, pe.stage_key INTO v_aberto
    FROM public.deals d
    JOIN public.pipeline_entries pe ON pe.deal_id = d.id
   WHERE d.source_lead_id = p_lead_id
     AND d.organization_id = p_org
     AND d.closed_at IS NULL
     AND d.deleted_at IS NULL
     AND pe.pipeline_id = v_pip.id
   LIMIT 1;

  IF FOUND THEN
    v_aviso := jsonb_build_object(
      'code', 'lead_has_open_deal_in_pipeline',
      'open_deal_id', v_aberto.id,
      'stage', v_aberto.stage_key);
  END IF;

  -- ── Delega para a porta única ─────────────────────────────────────────────
  -- p_pipe cru: abrir_negocio resolve com o MESMO resolvedor (inclusive a
  -- tradução stage_key→stage_id de funil custom, que morava aqui na fantasma).
  v_deal_id := public.abrir_negocio(
    p_lead_id, p_pipe, p_stage, p_owner_id, p_value, NULL, p_notes, p_title, p_source);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_deal_id)
    ON CONFLICT (organization_id, endpoint, idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.deals WHERE id = v_deal_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                               'value', v_row.value, 'source', v_row.source),
    'warning', v_aviso));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.garantir_negocio_da_entrada(p_entry_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_deal_id uuid; v_titulo text; v_valor numeric;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada % não existe', p_entry_id USING ERRCODE = '22023';
  END IF;
  IF v_entry.deal_id IS NOT NULL THEN
    RETURN v_entry.deal_id;
  END IF;

  SELECT COALESCE(NULLIF(l.name, ''), 'Negócio sem título') INTO v_titulo
    FROM public.leads l WHERE l.id = v_entry.lead_id;

  BEGIN
    v_valor := NULLIF(v_entry.metadata->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_valor := NULL;
  END;

  INSERT INTO public.deals (organization_id, title, value, source_lead_id, owner_id, source)
  VALUES (v_entry.organization_id, COALESCE(v_titulo, 'Negócio'), v_valor,
          v_entry.lead_id, v_entry.assigned_to, 'entrada_materializada')
  RETURNING id INTO v_deal_id;

  UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = p_entry_id;
  RETURN v_deal_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_commission_ledger(p_org_id uuid, p_period text, p_ref date DEFAULT NULL::date, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_filter_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bounds tstzrange; v_comm_total numeric; v_base_total numeric; v_cnt_total integer; v_by_member jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  WITH ledger AS (
    SELECT c.team_member_id AS member_id, c.type AS ptype, c.amount AS amount, c.rate_percent AS rate_percent, se.sale_value AS base_value
    FROM public.commissions c
    JOIN public.sale_events se ON se.id = c.sale_event_id
    WHERE c.source = 'sale_event_projection' AND c.organization_id = p_org_id
      AND se.event_type = 'sale' AND se.sold_at <@ v_bounds
      AND (p_filter_member_id IS NULL OR c.team_member_id = p_filter_member_id)
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
  ),
  member_agg AS (
    SELECT l.member_id,
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
    COALESCE(SUM(m.commission), 0), COALESCE(SUM(m.base_revenue), 0), COALESCE(SUM(m.sale_count), 0)::int,
    COALESCE(jsonb_agg(jsonb_build_object(
      'member_id', m.member_id, 'commission', m.commission, 'base_revenue', m.base_revenue, 'sale_count', m.sale_count,
      'by_type', jsonb_build_object(
        'mrr', jsonb_build_object('commission', m.mrr_commission, 'base_revenue', m.mrr_base, 'sale_count', m.mrr_count, 'rate_percent', m.mrr_rate),
        'projeto', jsonb_build_object('commission', m.proj_commission, 'base_revenue', m.proj_base, 'sale_count', m.proj_count, 'rate_percent', m.proj_rate)
      )) ORDER BY m.commission DESC, m.base_revenue DESC), '[]'::jsonb)
  INTO v_comm_total, v_base_total, v_cnt_total, v_by_member
  FROM member_agg m;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'filter_member_id', p_filter_member_id, 'commission_total', v_comm_total, 'base_revenue_total', v_base_total,
    'sale_count_total', v_cnt_total, 'by_member', v_by_member
  );
END;
$function$
;
COMMIT;

