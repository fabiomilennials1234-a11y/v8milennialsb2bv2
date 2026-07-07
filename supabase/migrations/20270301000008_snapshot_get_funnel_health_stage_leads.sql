-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

CREATE OR REPLACE FUNCTION public.get_funnel_health_stage_leads(p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_stage text, p_origins text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF p_stage NOT IN ('entraram', 'avaliados', 'bons', 'reuniao', 'compareceram', 'compraram') THEN
    RAISE EXCEPTION 'invalid_stage: %', p_stage USING ERRCODE = 'P0001';
  END IF;

  WITH cohort AS (
    SELECT l.id,
           l.name,
           l.company,
           l.created_at,
           COALESCE(l.qualification_tier, l.pre_qualification_tier) AS tier,
           COALESCE(l.pre_sale_responsible_id, l.sdr_id, l.responsible_id) AS tm_id
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_origins IS NULL OR cardinality(p_origins) = 0 OR l.origin::text = ANY(p_origins))
  ),
  meetings AS (
    SELECT me.lead_id,
           bool_or(me.event_type = 'meeting_booked') AS booked,
           bool_or(me.event_type = 'meeting_held') AS held,
           max(me.meeting_date) FILTER (WHERE me.event_type = 'meeting_booked') AS meeting_date,
           max(me.occurred_at) FILTER (WHERE me.event_type = 'meeting_held') AS held_at
    FROM meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.lead_id IN (SELECT id FROM cohort)
    GROUP BY me.lead_id
  ),
  propostas AS (
    -- entry mais recente do lead em Orçamentos (estado atual no funil de fechamento)
    SELECT DISTINCT ON (pe.lead_id)
           pe.lead_id,
           pe.stage_key AS proposta_stage,
           (pe.metadata ->> 'sale_value')::numeric AS sale_value
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id
      AND pe.lead_id IN (SELECT id FROM cohort)
    ORDER BY pe.lead_id, pe.created_at DESC
  ),
  whatsapp_pos AS (
    -- posição atual no funil de Oportunidades (stage_key cru; o front humaniza)
    SELECT DISTINCT ON (pe.lead_id)
           pe.lead_id,
           pe.stage_key AS whatsapp_stage
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'whatsapp' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id
      AND pe.lead_id IN (SELECT id FROM cohort)
    ORDER BY pe.lead_id, pe.created_at DESC
  ),
  enriched AS (
    SELECT c.*,
           w.whatsapp_stage,
           COALESCE(m.booked, false) AS booked,
           COALESCE(m.held, false) AS held,
           m.meeting_date,
           m.held_at,
           p.proposta_stage,
           p.sale_value,
           (p.proposta_stage = 'vendido') IS TRUE AS sold,
           tm.name AS pre_vendas
    FROM cohort c
    LEFT JOIN meetings m ON m.lead_id = c.id
    LEFT JOIN propostas p ON p.lead_id = c.id
    LEFT JOIN team_members tm ON tm.id = c.tm_id
    LEFT JOIN whatsapp_pos w ON w.lead_id = c.id
  ),
  filtered AS (
    SELECT *
    FROM enriched e
    WHERE CASE p_stage
      WHEN 'entraram' THEN true
      WHEN 'avaliados' THEN e.tier IS NOT NULL
      WHEN 'bons' THEN e.tier IN ('prata', 'ouro', 'diamante')
      WHEN 'reuniao' THEN e.booked
      WHEN 'compareceram' THEN e.held
      WHEN 'compraram' THEN e.sold
    END
    ORDER BY e.created_at DESC
    LIMIT 500
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'company', f.company,
        'tier', f.tier,
        'created_at', f.created_at,
        'pre_vendas', f.pre_vendas,
        'proposta_stage', f.proposta_stage,
        'sale_value', f.sale_value,
        'meeting_date', f.meeting_date,
        'held_at', f.held_at,
        'whatsapp_stage', f.whatsapp_stage
      )
      ORDER BY f.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM filtered f;

  RETURN v_result;
END;
$function$;
