-- Indicador de Saúde do Funil — RPC get_funnel_health.
-- Semantics locked in CONTEXT.md (Funnel Health Indicator): cohort by lead
-- creation period; blocks count "ever reached" (events at any time).

CREATE OR REPLACE FUNCTION public.get_funnel_health(
  p_org_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int := 0;
  v_avaliados int := 0;
  v_bons int := 0;
  v_reuniao int := 0;
  v_compareceram int := 0;
  v_compraram int := 0;
  v_tiers jsonb := '{}'::jsonb;
  v_depth jsonb := '{}'::jsonb;
  v_sellers jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  WITH cohort AS (
    SELECT id,
           COALESCE(qualification_tier, pre_qualification_tier) AS tier_efetivo,
           (qualification_tier IS NOT NULL) AS has_final,
           -- Pré-vendas canônico com fallback legado (ADR-0007)
           COALESCE(pre_sale_responsible_id, sdr_id, responsible_id) AS tm_id
    FROM leads
    WHERE organization_id = p_org_id
      AND deleted_at IS NULL
      AND created_at >= p_start_date
      AND created_at <= p_end_date
  ),
  meetings AS (
    -- "ever reached": events count at ANY time, deduped per lead
    SELECT me.lead_id,
           bool_or(me.event_type = 'meeting_booked') AS booked,
           bool_or(me.event_type = 'meeting_held') AS held
    FROM meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.lead_id IN (SELECT id FROM cohort)
    GROUP BY me.lead_id
  ),
  vendas AS (
    -- mirrors the pipe_propostas view: system pipeline slug 'propostas'
    SELECT DISTINCT pe.lead_id
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id
      AND pe.stage_key = 'vendido'
      AND pe.lead_id IN (SELECT id FROM cohort)
  ),
  enriched AS (
    SELECT c.id,
           c.tier_efetivo,
           c.has_final,
           c.tm_id,
           COALESCE(m.booked, false) AS booked,
           COALESCE(m.held, false) AS held,
           (v.lead_id IS NOT NULL) AS sold
    FROM cohort c
    LEFT JOIN meetings m ON m.lead_id = c.id
    LEFT JOIN vendas v ON v.lead_id = c.id
  )
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE e.tier_efetivo IS NOT NULL),
         COUNT(*) FILTER (WHERE e.tier_efetivo IN ('prata', 'ouro', 'diamante')),
         COUNT(*) FILTER (WHERE e.booked),
         COUNT(*) FILTER (WHERE e.held),
         COUNT(*) FILTER (WHERE e.sold),
         jsonb_build_object(
           'diamante', COUNT(*) FILTER (WHERE e.tier_efetivo = 'diamante'),
           'ouro', COUNT(*) FILTER (WHERE e.tier_efetivo = 'ouro'),
           'prata', COUNT(*) FILTER (WHERE e.tier_efetivo = 'prata'),
           'bronze', COUNT(*) FILTER (WHERE e.tier_efetivo = 'bronze'),
           'desqualificado', COUNT(*) FILTER (WHERE e.tier_efetivo = 'desqualificado')
         ),
         jsonb_build_object(
           'pre_only', COUNT(*) FILTER (WHERE e.tier_efetivo IS NOT NULL AND NOT e.has_final),
           'final', COUNT(*) FILTER (WHERE e.has_final)
         ),
         (
           SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'team_member_id', s.tm_id,
                 'name', s.name,
                 'vinculados', s.vinculados,
                 'avaliados', s.avaliados,
                 'bons', s.bons,
                 'reuniao', s.reuniao,
                 'compareceram', s.compareceram,
                 'compraram', s.compraram
               )
               ORDER BY s.vinculados DESC, s.name NULLS LAST
             ),
             '[]'::jsonb
           )
           FROM (
             SELECT e2.tm_id,
                    tm.name,
                    COUNT(*) AS vinculados,
                    COUNT(*) FILTER (WHERE e2.tier_efetivo IS NOT NULL) AS avaliados,
                    COUNT(*) FILTER (WHERE e2.tier_efetivo IN ('prata', 'ouro', 'diamante')) AS bons,
                    COUNT(*) FILTER (WHERE e2.booked) AS reuniao,
                    COUNT(*) FILTER (WHERE e2.held) AS compareceram,
                    COUNT(*) FILTER (WHERE e2.sold) AS compraram
             FROM enriched e2
             LEFT JOIN team_members tm ON tm.id = e2.tm_id
             GROUP BY e2.tm_id, tm.name
           ) s
         )
  INTO v_total, v_avaliados, v_bons, v_reuniao, v_compareceram, v_compraram, v_tiers, v_depth, v_sellers
  FROM enriched e;

  RETURN jsonb_build_object(
    'cohort_total', v_total,
    'stages', jsonb_build_object(
      'entraram', v_total,
      'avaliados', v_avaliados,
      'bons', v_bons,
      'reuniao', v_reuniao,
      'compareceram', v_compareceram,
      'compraram', v_compraram
    ),
    'tiers', v_tiers,
    'depth', v_depth,
    'sellers', v_sellers
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_funnel_health(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_funnel_health(uuid, timestamptz, timestamptz) TO authenticated, service_role;
