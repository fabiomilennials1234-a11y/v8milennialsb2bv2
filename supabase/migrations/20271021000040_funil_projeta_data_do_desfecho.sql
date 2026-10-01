-- O board agrupa os cards ganhos e perdidos de cada etapa por MÊS do desfecho.
-- A data certa é `deals.outcome_at` (ADR-0023 Emenda 1): o instante em que o
-- negócio foi ganho ou perdido. `stage_changed_at` não serve — card ganho num
-- funil sem etapa de ganho não muda de etapa, e card mexido depois do ganho
-- mudaria de mês.
--
-- `get_pipeline_page` passa a projetar `metadata.deal_outcome_at` pelo mesmo
-- caminho de `deal_outcome` (20271021000039) — mesma assinatura, mesmo
-- RETURNS, nenhum grant tocado. Card sem negócio não recebe a chave; o front
-- recua para `stage_changed_at`. Só leitura: nenhum dado de cliente é escrito.
--
-- Corpo idêntico ao vivo em prod em 2026-10-01 (comparado com o 20271021000039,
-- espaços normalizados), mais a projeção da data.

CREATE OR REPLACE FUNCTION public.get_pipeline_page(
  p_pipeline_slug text DEFAULT NULL::text,
  p_stage_id text DEFAULT NULL::text,
  p_org_id uuid DEFAULT NULL::uuid,
  p_page_size integer DEFAULT 20,
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_search text DEFAULT NULL::text,
  p_responsible_id uuid DEFAULT NULL::uuid,
  p_tag_ids uuid[] DEFAULT NULL::uuid[],
  p_origins text[] DEFAULT NULL::text[],
  p_rating_min integer DEFAULT NULL::integer,
  p_rating_max integer DEFAULT NULL::integer,
  p_calor_min integer DEFAULT NULL::integer,
  p_calor_max integer DEFAULT NULL::integer,
  p_urgency text DEFAULT NULL::text,
  p_product_type text DEFAULT NULL::text,
  p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_closed_status_keys text[] DEFAULT NULL::text[],
  p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_overdue_exclude_status_keys text[] DEFAULT NULL::text[],
  p_status_keys text[] DEFAULT NULL::text[],
  p_scheduled boolean DEFAULT NULL::boolean,
  p_qualification_tier text[] DEFAULT NULL::text[],
  p_pre_qualification_tier text[] DEFAULT NULL::text[],
  p_stalled_min_days integer DEFAULT NULL::integer,
  p_stalled_max_days integer DEFAULT NULL::integer,
  p_pipeline_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, pipeline_id uuid, lead_id uuid, stage_key text, assigned_to uuid, notes text, metadata jsonb, entered_at timestamp with time zone, stage_changed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, lead jsonb)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE v_pipeline_id UUID;
BEGIN
  IF p_org_id IS NULL OR (p_pipeline_id IS NULL AND p_pipeline_slug IS NULL) THEN
    RETURN;
  END IF;
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.organization_id = p_org_id
     AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
       OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_slug));
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pe.id, pe.pipeline_id, pe.lead_id, pe.stage_key, pe.assigned_to, pe.notes,
    CASE
      WHEN d.id IS NULL THEN pe.metadata
      ELSE jsonb_set(jsonb_set(
        CASE
          WHEN d.value IS NULL THEN COALESCE(pe.metadata, '{}'::jsonb)
          ELSE jsonb_set(COALESCE(pe.metadata, '{}'::jsonb), '{sale_value}', to_jsonb(d.value), true)
        END,
        '{deal_outcome}', to_jsonb(d.outcome), true),
        -- `to_jsonb(NULL)` é NULL e `jsonb_set(..., NULL)` devolve NULL: sem o
        -- COALESCE, negócio sem data de desfecho apagaria o metadata inteiro.
        '{deal_outcome_at}', COALESCE(to_jsonb(d.outcome_at), 'null'::jsonb), true)
    END AS metadata,
    pe.entered_at, pe.stage_changed_at, pe.created_at, pe.updated_at,
    jsonb_build_object(
      'id', l.id, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone,
      'rating', l.rating, 'origin', l.origin, 'segment', l.segment, 'faturamento', l.faturamento,
      'urgency', l.urgency, 'notes', l.notes, 'compromisso_date', l.compromisso_date,
      'ai_disabled', l.ai_disabled, 'avatar_url', l.avatar_url,
      'erp_code', l.erp_code,
      'pre_qualification_tier', l.pre_qualification_tier, 'qualification_tier', l.qualification_tier,
      'sdr_id', l.sdr_id, 'closer_id', l.closer_id, 'responsible_id', l.responsible_id,
      'pre_sale_responsible_id', l.pre_sale_responsible_id, 'sale_responsible_id', l.sale_responsible_id,
      'responsible', CASE WHEN tm_resp.id IS NOT NULL THEN jsonb_build_object('id', tm_resp.id, 'name', tm_resp.name, 'avatar_url', tm_resp.avatar_url) ELSE NULL END,
      'sdr', CASE WHEN tm_sdr.id IS NOT NULL THEN jsonb_build_object('id', tm_sdr.id, 'name', tm_sdr.name, 'avatar_url', tm_sdr.avatar_url) ELSE NULL END,
      'closer', CASE WHEN tm_closer.id IS NOT NULL THEN jsonb_build_object('id', tm_closer.id, 'name', tm_closer.name, 'avatar_url', tm_closer.avatar_url) ELSE NULL END,
      'pre_sale_responsible', CASE WHEN tm_pre.id IS NOT NULL THEN jsonb_build_object('id', tm_pre.id, 'name', tm_pre.name, 'avatar_url', tm_pre.avatar_url) ELSE NULL END,
      'sale_responsible', CASE WHEN tm_sale.id IS NOT NULL THEN jsonb_build_object('id', tm_sale.id, 'name', tm_sale.name, 'avatar_url', tm_sale.avatar_url) ELSE NULL END,
      'lead_tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))) FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id), '[]'::jsonb)
    ) AS lead
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
  LEFT JOIN public.team_members tm_resp ON tm_resp.id = l.responsible_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = l.sdr_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = l.closer_id
  LEFT JOIN public.team_members tm_pre ON tm_pre.id = l.pre_sale_responsible_id
  LEFT JOIN public.team_members tm_sale ON tm_sale.id = l.sale_responsible_id
  WHERE pe.pipeline_id = v_pipeline_id AND pe.stage_key = p_stage_id AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL AND (p_cursor IS NULL OR pe.created_at < p_cursor)
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%' OR l.erp_code ILIKE '%' || p_search || '%'))
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
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: filtro de lista por inatividade; não ancora métrica nem soma receita
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  ORDER BY pe.created_at DESC LIMIT p_page_size;
END;
$function$;

-- ACL idêntica à de prod em 2026-10-01 ({postgres, authenticated, service_role}).
-- CREATE OR REPLACE já a preserva; reemitir é no-op lá.
REVOKE ALL ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) TO service_role;

-- Guardas: a migration se recusa a concluir errada.
DO $$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_pipeline_page tem % assinaturas — a chamada ficaria ambigua', v_n;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page';
  IF v_def NOT LIKE '%deal_outcome_at%' OR v_def NOT LIKE '%deal_outcome}%' OR v_def NOT LIKE '%d.value%' THEN
    RAISE EXCEPTION 'get_pipeline_page nao projeta deal_outcome, deal_outcome_at e deals.value';
  END IF;
  IF v_def NOT LIKE '%COALESCE(to_jsonb(d.outcome_at), ''null''::jsonb)%' THEN
    RAISE EXCEPTION 'deal_outcome_at sem COALESCE — negocio sem data apagaria o metadata';
  END IF;
  IF v_def NOT LIKE '%d.organization_id = pe.organization_id%' THEN
    RAISE EXCEPTION 'join de deals perdeu isolamento por organizacao';
  END IF;
  IF has_function_privilege('anon', 'public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon tem EXECUTE em get_pipeline_page';
  END IF;
END $$;
