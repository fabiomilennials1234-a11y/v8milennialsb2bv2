-- Rollback: volta a buscar etapas só em pipeline_stages (funil personalizado
-- volta a devolver "stages": []).
CREATE OR REPLACE FUNCTION public.api_list_pipelines(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pip.id, 'name', pip.name, 'slug', pip.slug,
    'type', pip.type, 'color', pip.color, 'icon', pip.icon, 'display_order', pip.display_order,
    'is_active', pip.is_active,
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage_key', ps.stage_key, 'name', ps.name,
      'color', ps.color, 'position', ps.position, 'is_active', ps.is_active,
      'is_final_positive', ps.is_final_positive, 'is_final_negative', ps.is_final_negative)
      ORDER BY ps.position)
      FROM pipeline_stages ps WHERE ps.organization_id = p_org AND ps.pipeline_type = pip.slug), '[]'::jsonb)
  ) ORDER BY pip.display_order), '[]'::jsonb)
  FROM pipelines pip WHERE pip.organization_id = p_org AND pip.is_active = true;
$$;
