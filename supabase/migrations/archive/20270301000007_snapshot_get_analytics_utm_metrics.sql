-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.
-- Anti-padrões existentes estão no backlog congelado do metric-lint (baseline).

CREATE OR REPLACE FUNCTION public.get_analytics_utm_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_level text DEFAULT 'campaign'::text, p_campaign text DEFAULT NULL::text, p_adset text DEFAULT NULL::text, p_ad text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Leads level: return individual leads ──
  IF p_level = 'leads' THEN
    SELECT jsonb_build_object('items', COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb))
    INTO v_result
    FROM (
      SELECT
        l.id,
        l.name,
        l.email,
        l.phone,
        l.created_at,
        COALESCE(
          (SELECT pw.status FROM pipe_whatsapp pw WHERE pw.lead_id = l.id ORDER BY pw.created_at DESC LIMIT 1),
          'sem pipe'
        ) AS pipe_status,
        COALESCE(
          (SELECT tm.name FROM team_members tm WHERE tm.id = l.responsible_id),
          'Não atribuído'
        ) AS responsible,
        COALESCE(l.rating, 0) AS rating
      FROM leads l
      WHERE l.organization_id = p_org_id
        AND l.created_at >= p_start_date::timestamp
        AND l.created_at < (p_end_date + 1)::timestamp
        AND l.utm_campaign IS NOT NULL
        AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
        AND (p_campaign IS NULL OR l.utm_campaign = p_campaign)
        AND (p_adset IS NULL OR l.utm_content = p_adset)
        AND (p_ad IS NULL OR l.utm_term = p_ad)
      ORDER BY l.created_at DESC
    ) t;

    RETURN v_result;
  END IF;

  -- ── Aggregated levels: campaign / adset / ad ──
  WITH filtered_leads AS (
    SELECT
      l.id,
      l.utm_campaign,
      l.utm_content,
      l.utm_term,
      l.meta_campaign_id,
      l.meta_adset_id,
      l.meta_ad_id,
      l.rating,
      l.responsible_id
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND l.created_at >= p_start_date::timestamp
      AND l.created_at < (p_end_date + 1)::timestamp
      AND l.utm_campaign IS NOT NULL
      AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
      AND (p_campaign IS NULL OR l.utm_campaign = p_campaign)
      AND (p_adset IS NULL OR l.utm_content = p_adset)
      AND (p_ad IS NULL OR l.utm_term = p_ad)
  ),
  lead_proposals AS (
    SELECT
      pp.lead_id,
      pp.status,
      COALESCE(pp.sale_value, 0) AS sale_value
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.lead_id IN (SELECT id FROM filtered_leads)
  ),
  grouped AS (
    SELECT
      CASE p_level
        WHEN 'campaign' THEN fl.utm_campaign
        WHEN 'adset'    THEN fl.utm_content
        WHEN 'ad'       THEN fl.utm_term
      END AS name,
      CASE p_level
        WHEN 'campaign' THEN fl.meta_campaign_id
        WHEN 'adset'    THEN fl.meta_adset_id
        WHEN 'ad'       THEN fl.meta_ad_id
      END AS meta_id,
      COUNT(DISTINCT fl.id) AS total_leads,
      COUNT(DISTINCT CASE WHEN lp.status = 'vendido' THEN fl.id END) AS converted,
      COALESCE(SUM(CASE WHEN lp.status = 'vendido' THEN lp.sale_value ELSE 0 END), 0) AS revenue,
      ROUND(AVG(fl.rating) FILTER (WHERE fl.rating IS NOT NULL), 1) AS avg_rating
    FROM filtered_leads fl
    LEFT JOIN lead_proposals lp ON lp.lead_id = fl.id
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'name', g.name,
        'meta_id', g.meta_id,
        'total_leads', g.total_leads,
        'converted', g.converted,
        'conversion_rate', CASE WHEN g.total_leads > 0
          THEN ROUND((g.converted::numeric / g.total_leads) * 100, 1)
          ELSE 0 END,
        'revenue', g.revenue,
        'avg_rating', COALESCE(g.avg_rating, 0)
      )
      ORDER BY g.total_leads DESC
    ), '[]'::jsonb)
  ) INTO v_result
  FROM grouped g;

  RETURN v_result;
END;
$function$;
