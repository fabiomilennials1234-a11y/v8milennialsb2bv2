-- Carteira dentro de Leads: filtros e agregados antes de LIMIT/OFFSET.
-- INVOKER: mantém a RLS de leads (inclusive atribuição), vendas e pedidos.
-- Receita mensal vem exclusivamente do ledger; total comprado mantém
-- precedência CRM/Carteira. Não escreve nem reclassifica clientes.
BEGIN;
CREATE FUNCTION public.client_portfolio_page(
  p_organization_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
-- Bulk aggregation joins: RLS can estimate one visible row even for large
-- tenants. Avoid repeatedly scanning grouped history in nested loops. This
-- setting is function-local and restores the caller's planner configuration.
SET enable_nestloop = off
AS $function$
DECLARE
  v_source text := coalesce(p_filters->>'source', 'relationship');
  v_segment text := coalesce(p_filters->>'segment', 'all');
  v_reorder text := coalesce(p_filters->>'reorder', 'all');
  v_sort text := coalesce(p_filters->>'sort', 'created_at');
  v_direction text := coalesce(p_filters->>'direction', 'desc');
  v_search text := nullif(btrim(p_filters->>'search'), '');
  v_pattern text;
  v_digits text;
  v_owner text := coalesce(p_filters->>'responsible', 'all');
  v_timezone text;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_month_start timestamptz;
  v_next_month timestamptz;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and organization required' USING ERRCODE = '42501';
  END IF;
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0
    OR v_source NOT IN ('relationship', 'erp', 'cafe')
    OR v_segment NOT IN ('all', 'none', 'ouro', 'prata', 'bronze', 'novo', 'resgate', 'dormindo')
    OR v_reorder NOT IN ('all', 'late', 'soon', 'on-time', 'unknown')
    OR v_sort NOT IN ('name', 'created_at') OR v_direction NOT IN ('asc', 'desc')
    OR length(coalesce(v_search, '')) > 250
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN
      ('source','segment','reorder','sort','direction','search','origin','qualification','responsible','uf','createdFrom','createdTo','unassigned'))
  THEN RAISE EXCEPTION 'Invalid portfolio filters or pagination' USING ERRCODE = '22023'; END IF;
  IF v_owner NOT IN ('all', 'none') AND v_owner !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid responsible member' USING ERRCODE = '22023';
  END IF;
  IF v_owner NOT IN ('all','none') THEN v_owner := (v_owner::uuid)::text; END IF;
  -- Literal search (including punctuation), never dynamic SQL/PostgREST grammar.
  v_pattern := '%' || replace(replace(replace(v_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  v_digits := regexp_replace(coalesce(v_search, ''), '[^0-9]', '', 'g');
  SELECT o.timezone INTO v_timezone FROM public.organizations o WHERE o.id = p_organization_id;
  v_timezone := coalesce(nullif(v_timezone, ''), 'America/Sao_Paulo');
  v_month_start := date_trunc('month', v_now AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_next_month := (date_trunc('month', v_now AT TIME ZONE v_timezone) + interval '1 month') AT TIME ZONE v_timezone;

  -- Set-based equivalent of relacao_negocios(l) = 'cliente'. Keep parity
  -- tests against the canonical computed field: do not execute its joins once
  -- per customer when aggregating a whole tenant.
  WITH relationship_clients AS MATERIALIZED (
    SELECT d.source_lead_id AS lead_id FROM public.deals d
    WHERE v_source='relationship' AND d.organization_id=p_organization_id
      AND d.deleted_at IS NULL AND d.outcome='won'
    UNION
    SELECT pe.lead_id FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id=pe.pipeline_id AND p.organization_id=pe.organization_id AND p.is_active=true
    LEFT JOIN public.deals d ON d.id=pe.deal_id AND d.organization_id=pe.organization_id AND d.deleted_at IS NULL
    LEFT JOIN public.pipeline_stages st ON st.pipeline_id=pe.pipeline_id AND st.organization_id=pe.organization_id
      AND st.is_active=true AND (st.stage_key=pe.stage_key OR st.id::text=pe.stage_key)
    WHERE v_source='relationship' AND pe.organization_id=p_organization_id
      AND (pe.deal_id IS NULL OR d.id IS NOT NULL)
      AND CASE WHEN d.outcome IN ('won','lost','open') THEN d.outcome ELSE st.stage_role::text END='won'
    UNION
    SELECT s.lead_id FROM public.sale_events s
    WHERE v_source='relationship' AND s.organization_id=p_organization_id
      AND s.event_type='sale' AND s.reversed_event_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.organization_id=s.organization_id AND r.reversed_event_id=s.id)
  ), eligible AS MATERIALIZED (
    SELECT l.id, l.name, l.company, l.email, l.phone, l.erp_code, l.created_at
    FROM public.leads l
    WHERE l.organization_id = p_organization_id AND l.deleted_at IS NULL AND coalesce(l.is_shadow, false) = false
      AND CASE v_source
        WHEN 'cafe' THEN public.visivel_lista_cafe_jurere(l) AND public.classificacao_cafe_jurere(l) = 'cliente'
        WHEN 'erp' THEN l.classificacao = 'cliente'
        ELSE l.id IN (SELECT rc.lead_id FROM relationship_clients rc)
      END
      AND (v_search IS NULL OR l.name ILIKE v_pattern OR l.company ILIKE v_pattern OR l.email ILIKE v_pattern
        OR l.phone ILIKE v_pattern OR l.erp_code ILIKE v_pattern
        OR (length(v_digits) >= 4 AND l.normalized_phone ILIKE '%' || v_digits || '%'))
      AND (coalesce(p_filters->>'origin', 'all') = 'all' OR l.origin = p_filters->>'origin')
      AND (nullif(p_filters->>'uf', '') IS NULL OR l.uf = p_filters->>'uf')
      AND (nullif(p_filters->>'createdFrom', '') IS NULL OR l.created_at >= (p_filters->>'createdFrom')::timestamptz)
      AND (nullif(p_filters->>'createdTo', '') IS NULL OR l.created_at <= (p_filters->>'createdTo')::timestamptz)
      AND (coalesce(p_filters->>'qualification', 'all') = 'all'
        OR (p_filters->>'qualification' = 'none' AND l.qualification_tier IS NULL)
        OR l.qualification_tier::text = p_filters->>'qualification')
      AND (coalesce((p_filters->>'unassigned')::boolean, false) = false
        OR (l.pre_sale_responsible_id IS NULL AND l.sale_responsible_id IS NULL AND l.sdr_id IS NULL AND l.closer_id IS NULL))
      -- Dono da CONTA, não atribuição de receita. Mesmo contrato da lista.
      AND (v_owner = 'all'
        OR (v_owner = 'none' AND l.sale_responsible_id IS NULL AND l.pre_sale_responsible_id IS NULL AND l.responsible_id IS NULL)
        OR (v_owner NOT IN ('all','none') AND CASE
          WHEN l.sale_responsible_id IS NOT NULL THEN l.sale_responsible_id::text
          WHEN l.pre_sale_responsible_id IS NOT NULL THEN l.pre_sale_responsible_id::text
          ELSE l.responsible_id::text END = v_owner))
  ), sales AS MATERIALIZED (
    SELECT s.id, s.lead_id, s.sold_at, s.sale_value
    FROM public.sale_events s JOIN eligible e ON e.id = s.lead_id
    WHERE s.organization_id = p_organization_id AND s.event_type = 'sale' AND s.reversed_event_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
        WHERE r.organization_id = s.organization_id AND r.reversed_event_id = s.id)
  ), accounts AS MATERIALIZED (
    SELECT c.id, c.lead_id, c.segment
    FROM public.upsell_clients c JOIN eligible e ON e.id = c.lead_id
    WHERE c.organization_id = p_organization_id
  ), orders AS MATERIALIZED (
    SELECT o.id, c.lead_id, o.sold_at, o.sale_value
    FROM public.upsell_orders o JOIN accounts c ON c.id = o.client_id
    WHERE o.organization_id = p_organization_id AND o.approval_status = 'approved'
  ), sale_totals AS (
    SELECT s.lead_id, count(*)::integer AS purchases, coalesce(sum(s.sale_value),0) AS total,
      coalesce(sum(s.sale_value) / nullif(count(*) FILTER (WHERE s.sale_value > 0),0),0) AS average,
      coalesce(sum(s.sale_value) FILTER (WHERE s.sold_at >= v_month_start AND s.sold_at < v_next_month),0) AS month_revenue
    FROM sales s GROUP BY s.lead_id
  ), order_totals AS (
    -- Total COMPRADO legado, não receita mensal. Nunca somado ao CRM.
    SELECT o.lead_id, count(*)::integer AS purchases, coalesce(sum(o.sale_value),0) AS total,
      coalesce(avg(o.sale_value),0) AS average FROM orders o GROUP BY o.lead_id
  ), purchase_days AS (
    SELECT s.lead_id, (s.sold_at AT TIME ZONE 'UTC')::date AS day FROM sales s WHERE s.sold_at IS NOT NULL
    UNION
    SELECT o.lead_id, (o.sold_at AT TIME ZONE 'UTC')::date FROM orders o WHERE o.sold_at IS NOT NULL
  ), cadence AS (
    SELECT d.lead_id, count(*)::integer AS days, min(d.day) AS first_day, max(d.day) AS last_day,
      CASE WHEN count(*) > 1 THEN greatest(1, round((max(d.day)-min(d.day))::numeric / (count(*)-1)))::integer END AS cycle_days
    FROM purchase_days d GROUP BY d.lead_id
  ), segments AS (
    SELECT DISTINCT ON (a.lead_id) a.lead_id, a.segment FROM accounts a ORDER BY a.lead_id,a.id
  ), measured AS (
    SELECT e.id, e.name, e.company, e.email, e.phone, e.erp_code, e.created_at,
      sg.segment,
      coalesce(s.total, o.total, 0) AS lifetime_value, coalesce(s.average, o.average, 0) AS avg_ticket,
      coalesce(s.purchases, o.purchases, 0) AS order_count, coalesce(s.month_revenue,0) AS month_revenue,
      coalesce(c.days,0) AS purchase_days, c.first_day, c.last_day, c.cycle_days,
      CASE WHEN c.last_day IS NOT NULL THEN greatest(0, v_today-c.last_day) END AS since_last,
      c.cycle_days - greatest(0, v_today-c.last_day) AS remaining
    FROM eligible e LEFT JOIN segments sg ON sg.lead_id=e.id LEFT JOIN sale_totals s ON s.lead_id=e.id
    LEFT JOIN order_totals o ON o.lead_id=e.id LEFT JOIN cadence c ON c.lead_id=e.id
  ), filtered AS MATERIALIZED (
    SELECT m.id, m.name, m.company, m.email, m.phone, m.erp_code, m.created_at,
      m.segment, m.lifetime_value, m.avg_ticket, m.order_count, m.month_revenue,
      m.purchase_days, m.first_day, m.last_day, m.cycle_days, m.since_last, m.remaining
    FROM measured m
    WHERE (v_segment='all' OR (v_segment='none' AND m.segment IS NULL) OR m.segment=v_segment)
      AND (v_reorder='all' OR (v_reorder='unknown' AND m.remaining IS NULL)
        OR (v_reorder='late' AND m.remaining<0) OR (v_reorder='soon' AND m.remaining BETWEEN 0 AND 7)
        OR (v_reorder='on-time' AND m.remaining>7))
  ), page AS (
    SELECT f.id, f.name, f.company, f.email, f.phone, f.erp_code, f.created_at,
      f.segment, f.lifetime_value, f.avg_ticket, f.order_count, f.month_revenue,
      f.purchase_days, f.first_day, f.last_day, f.cycle_days, f.since_last, f.remaining,
      row_number() OVER (ORDER BY
        CASE WHEN v_sort='name' AND v_direction='asc' THEN f.name END ASC,
        CASE WHEN v_sort='name' AND v_direction='desc' THEN f.name END DESC,
        CASE WHEN v_sort='created_at' AND v_direction='asc' THEN f.created_at END ASC,
        CASE WHEN v_sort='created_at' AND v_direction='desc' THEN f.created_at END DESC, f.id ASC) AS position
    FROM filtered f
    ORDER BY position LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'asOf', v_now,
    'total', (SELECT count(*) FROM filtered),
    'summary', (SELECT jsonb_build_object('monthlyRevenue', coalesce(sum(f.month_revenue),0),
      'expectedCount', count(*) FILTER (WHERE f.remaining BETWEEN 0 AND 7),
      'overdueCount', count(*) FILTER (WHERE f.remaining<0)) FROM filtered f),
    'clients', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'company', p.company,
      'identity', coalesce(nullif(p.erp_code,''),p.email,p.phone),
      'firstPurchaseAt', p.first_day, 'lastPurchaseAt', p.last_day,
      'nextPurchaseAt', p.last_day + p.cycle_days,
      'metrics', jsonb_build_object('leadId',p.id,'lifetimeValue',p.lifetime_value,'avgTicket',p.avg_ticket,
        'orderCount',p.order_count,'reorderCycleDays',p.cycle_days,'daysSinceLastOrder',p.since_last,'segment',p.segment),
      'cycle', jsonb_build_object('estado',CASE WHEN p.purchase_days=0 THEN 'sem-compra' WHEN p.purchase_days=1 THEN 'uma-compra' ELSE 'com-ciclo' END,
        'compras',p.purchase_days,'mediaDias',p.cycle_days,'diasDesdeUltima',p.since_last,'diasRestantes',p.remaining,
        'progresso',CASE WHEN p.cycle_days IS NULL THEN 0 ELSE least(1, p.since_last::numeric/p.cycle_days) END,
        'emEpoca',coalesce(p.remaining<=7,false),
        'rotulo',CASE WHEN p.purchase_days=0 THEN 'Sem compra' WHEN p.purchase_days=1 THEN 'Sem informações' ELSE p.cycle_days::text||'D' END)
    ) ORDER BY p.position) FROM page p),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.client_portfolio_page(uuid,jsonb,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portfolio_page(uuid,jsonb,integer,integer) TO authenticated;
COMMENT ON FUNCTION public.client_portfolio_page(uuid,jsonb,integer,integer) IS
  'Carteira 360: clientes visíveis via RLS, filtro global, receita mensal líquida no fuso da org e recompra por datas distintas UTC. INVOKER; somente leitura.';
NOTIFY pgrst, 'reload schema';
COMMIT;
