-- Public REST API (ADR-0008) — RPC api_list_leads.
-- Keyset-paginated lead list for GET /api/v1/leads (Slice 1, #794).
--
-- Trust model: this function is SECURITY DEFINER and granted to service_role
-- ONLY. The `api` edge function runs as service_role, authenticates the API
-- key, and passes the key's organization as p_org. We do NOT call
-- assert_org_access here (that assumes a user JWT, which this path lacks);
-- instead p_org is the enforced tenant boundary and every predicate filters by
-- it (fail-closed). anon/authenticated are revoked so no user can reach it.
--
-- Semantics mirror existing canonical logic:
--   tier_efetivo = COALESCE(qualification_tier, pre_qualification_tier)
--   sold / sale_value from pipeline_entries (propostas system pipeline,
--   stage_key='vendido', metadata->>'sale_value') — same source as
--   get_funnel_health / snapshot_responsible_from_lead.

CREATE OR REPLACE FUNCTION public.api_list_leads(
  p_org uuid,
  p_stage text[] DEFAULT NULL,
  p_tier text[] DEFAULT NULL,
  p_tag text[] DEFAULT NULL,
  p_origin text[] DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_created_from timestamptz DEFAULT NULL,
  p_created_to timestamptz DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  company text,
  email text,
  phone text,
  origin text,
  rating int,
  qualification_score int,
  tier_efetivo text,
  tags jsonb,
  responsible_id uuid,
  sdr_id uuid,
  closer_id uuid,
  sold boolean,
  sale_value numeric,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    l.id,
    l.name,
    l.company,
    l.email,
    l.phone,
    l.origin::text,
    l.rating,
    l.qualification_score,
    COALESCE(l.qualification_tier, l.pre_qualification_tier)::text AS tier_efetivo,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
        FROM lead_tags lt
        JOIN tags t ON t.id = lt.tag_id
        WHERE lt.lead_id = l.id
      ),
      '[]'::jsonb
    ) AS tags,
    l.responsible_id,
    l.sdr_id,
    l.closer_id,
    COALESCE(v.sold, false) AS sold,
    v.sale_value,
    l.created_at
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT true AS sold, (pe.metadata->>'sale_value')::numeric AS sale_value
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.lead_id = l.id
      AND pe.organization_id = p_org
      AND pe.stage_key = 'vendido'
    LIMIT 1
  ) v ON true
  WHERE l.organization_id = p_org
    AND l.deleted_at IS NULL
    AND COALESCE(l.is_shadow, false) = false
    AND (p_tier IS NULL
         OR COALESCE(l.qualification_tier, l.pre_qualification_tier)::text = ANY(p_tier))
    AND (p_origin IS NULL OR l.origin::text = ANY(p_origin))
    AND (p_responsible_id IS NULL
         OR p_responsible_id IN (
              l.responsible_id, l.sdr_id, l.closer_id,
              l.pre_sale_responsible_id, l.sale_responsible_id
            ))
    AND (p_created_from IS NULL OR l.created_at >= p_created_from)
    AND (p_created_to IS NULL OR l.created_at <= p_created_to)
    AND (p_q IS NULL OR (
           l.name ILIKE '%' || p_q || '%'
        OR l.company ILIKE '%' || p_q || '%'
        OR l.email ILIKE '%' || p_q || '%'
        OR l.phone ILIKE '%' || p_q || '%'
    ))
    AND (p_stage IS NULL OR EXISTS (
           SELECT 1 FROM pipeline_entries pe2
           WHERE pe2.lead_id = l.id
             AND pe2.organization_id = p_org
             AND pe2.stage_key = ANY(p_stage)
    ))
    AND (p_tag IS NULL OR EXISTS (
           SELECT 1 FROM lead_tags lt2
           JOIN tags t2 ON t2.id = lt2.tag_id
           WHERE lt2.lead_id = l.id
             AND lower(t2.name) = ANY(SELECT lower(x) FROM unnest(p_tag) AS x)
    ))
    -- keyset on (created_at, id) DESC
    AND (
      p_cursor_created_at IS NULL
      OR l.created_at < p_cursor_created_at
      OR (l.created_at = p_cursor_created_at AND l.id < p_cursor_id)
    )
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

REVOKE ALL ON FUNCTION public.api_list_leads(
  uuid, text[], text[], text[], text[], uuid, timestamptz, timestamptz, text, int, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.api_list_leads(
  uuid, text[], text[], text[], text[], uuid, timestamptz, timestamptz, text, int, timestamptz, uuid
) TO service_role;
