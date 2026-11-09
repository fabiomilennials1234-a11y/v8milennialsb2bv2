-- Rollback de 20280101000000_funil_contagem_coluna_completa.sql
-- Volta ao corpo de get_pipeline_stage_counts_by_id vigente em prod em 09/11/2026
-- (sem erp_code na busca, sem co-dono). A flag funil_contagem_coluna_completa
-- passa a não ter efeito.

CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts_by_id(p_pipeline_id uuid, p_org_id uuid, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_origins text[] DEFAULT NULL::text[], p_rating_min integer DEFAULT NULL::integer, p_rating_max integer DEFAULT NULL::integer, p_calor_min integer DEFAULT NULL::integer, p_calor_max integer DEFAULT NULL::integer, p_urgency text DEFAULT NULL::text, p_product_type text DEFAULT NULL::text, p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_closed_status_keys text[] DEFAULT NULL::text[], p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_overdue_exclude_status_keys text[] DEFAULT NULL::text[], p_status_keys text[] DEFAULT NULL::text[], p_scheduled boolean DEFAULT NULL::boolean, p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_stalled_min_days integer DEFAULT NULL::integer, p_stalled_max_days integer DEFAULT NULL::integer)
 RETURNS TABLE(stage_id uuid, stage_key text, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pe.stage_id, pe.stage_key, COUNT(*)::BIGINT AS cnt
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.pipeline_id = p_pipeline_id AND pe.organization_id = p_org_id AND pe.lead_id IS NOT NULL
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%'))
    AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id))
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (SELECT unnest(p_tag_ids) EXCEPT SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id))
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL OR l.qualification_tier::text = ANY(p_qualification_tier))
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
    AND (p_urgency IS NULL OR l.urgency = p_urgency)
    AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
    AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
    AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
    AND (p_period_after IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) >= p_period_after)
    AND (p_period_before IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) <= p_period_before)
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: allow PRESERVADO do baseline, não é novo — filtro de lista "sem toque desde" (coluna Vencidos), não âncora de métrica
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  GROUP BY pe.stage_id, pe.stage_key;
END;
$function$;
