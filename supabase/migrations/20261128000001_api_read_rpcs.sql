-- Public REST API (ADR-0008) — read RPCs for Slice 2 (#795).
-- Lead 360, timeline, and catalogs. All SECURITY DEFINER, service_role-only;
-- p_org is the enforced tenant boundary (edge fn resolves it from the API key).

-- ── api_get_lead: lead 360 (returns jsonb object, NULL if not found) ─────────
CREATE OR REPLACE FUNCTION public.api_get_lead(p_org uuid, p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'company', l.company,
    'email', l.email,
    'phone', l.phone,
    'origin', l.origin::text,
    'rating', l.rating,
    'qualification_score', l.qualification_score,
    'tier', COALESCE(l.qualification_tier, l.pre_qualification_tier)::text,
    'responsible_id', l.responsible_id,
    'sdr_id', l.sdr_id,
    'closer_id', l.closer_id,
    'pre_sale_responsible_id', l.pre_sale_responsible_id,
    'sale_responsible_id', l.sale_responsible_id,
    'created_at', l.created_at,
    'updated_at', l.updated_at,
    'tags', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
      FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lead_id = l.id
    ), '[]'::jsonb),
    'custom_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'field_name', cf.field_name,
               'field_type', cf.field_type,
               'value', cfv.value
             ) ORDER BY cf.display_order)
      FROM lead_custom_field_values cfv
      JOIN lead_custom_fields cf ON cf.id = cfv.field_id
      WHERE cfv.lead_id = l.id
    ), '[]'::jsonb),
    'pipes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'pipeline', pip.slug,
               'pipeline_name', pip.name,
               'type', pip.type,
               'stage_key', pe.stage_key,
               'sold', (pe.stage_key = 'vendido' AND pip.slug = 'propostas' AND pip.type = 'system'),
               'sale_value', (pe.metadata->>'sale_value')::numeric,
               'entered_at', pe.entered_at,
               'stage_changed_at', pe.stage_changed_at
             ) ORDER BY pip.display_order)
      FROM pipeline_entries pe
      JOIN pipelines pip ON pip.id = pe.pipeline_id
      WHERE pe.lead_id = l.id AND pe.organization_id = p_org
    ), '[]'::jsonb)
  )
  FROM leads l
  WHERE l.id = p_lead_id
    AND l.organization_id = p_org
    AND l.deleted_at IS NULL;
$function$;

-- ── api_lead_timeline: keyset-paginated lead_history ─────────────────────────
CREATE OR REPLACE FUNCTION public.api_lead_timeline(
  p_org uuid,
  p_lead_id uuid,
  p_limit int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  description text,
  source text,
  entity_type text,
  entity_id uuid,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT h.id, h.created_at, h.action, h.description, h.source,
         h.entity_type, h.entity_id, h.metadata
  FROM lead_history h
  WHERE h.organization_id = p_org
    AND h.lead_id = p_lead_id
    AND (
      p_cursor_created_at IS NULL
      OR h.created_at < p_cursor_created_at
      OR (h.created_at = p_cursor_created_at AND h.id < p_cursor_id)
    )
  ORDER BY h.created_at DESC, h.id DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- ── api_list_pipelines: pipelines + stages (jsonb array) ─────────────────────
CREATE OR REPLACE FUNCTION public.api_list_pipelines(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pip.id,
    'name', pip.name,
    'slug', pip.slug,
    'type', pip.type,
    'color', pip.color,
    'icon', pip.icon,
    'display_order', pip.display_order,
    'is_active', pip.is_active,
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'stage_key', ps.stage_key,
               'name', ps.name,
               'color', ps.color,
               'position', ps.position,
               'is_active', ps.is_active,
               'is_final_positive', ps.is_final_positive,
               'is_final_negative', ps.is_final_negative
             ) ORDER BY ps.position)
      FROM pipeline_stages ps
      WHERE ps.organization_id = p_org AND ps.pipeline_type = pip.slug
    ), '[]'::jsonb)
  ) ORDER BY pip.display_order), '[]'::jsonb)
  FROM pipelines pip
  WHERE pip.organization_id = p_org AND pip.is_active = true;
$function$;

-- ── api_list_tags: tag catalog ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_list_tags(p_org uuid)
RETURNS TABLE (id uuid, name text, color text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT t.id, t.name, t.color
  FROM tags t
  WHERE t.organization_id = p_org
  ORDER BY t.name;
$function$;

-- ── api_list_custom_fields: custom field definitions catalog ─────────────────
CREATE OR REPLACE FUNCTION public.api_list_custom_fields(p_org uuid)
RETURNS TABLE (
  id uuid,
  field_name text,
  field_type text,
  field_options jsonb,
  is_required boolean,
  display_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT cf.id, cf.field_name, cf.field_type, cf.field_options,
         cf.is_required, cf.display_order
  FROM lead_custom_fields cf
  WHERE cf.organization_id = p_org
  ORDER BY cf.display_order;
$function$;

-- Permissions: service_role only (reached exclusively via the api edge function)
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.api_get_lead(uuid, uuid)',
    'public.api_lead_timeline(uuid, uuid, int, timestamptz, uuid)',
    'public.api_list_pipelines(uuid)',
    'public.api_list_tags(uuid)',
    'public.api_list_custom_fields(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', sig);
  END LOOP;
END $$;
