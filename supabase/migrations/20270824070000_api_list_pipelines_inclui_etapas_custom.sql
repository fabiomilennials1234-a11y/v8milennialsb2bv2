-- ============================================================================
-- `GET /api/v1/pipelines` passa a devolver as etapas dos funis PERSONALIZADOS.
--
-- A versão anterior buscava etapas só em `pipeline_stages`, casando por
-- `ps.pipeline_type = pip.slug`. Esse casamento só existe para funil de sistema:
-- funil personalizado guarda as etapas em `custom_pipeline_stages`, endereçadas
-- por `pipeline_id`. Resultado medido em prod (org Milennials, 2026-08-24): os
-- três funis personalizados voltavam com `"stages": []`, enquanto os três de
-- sistema vinham completos.
--
-- Quem consome isso não tinha como saber: a chave `stages` existia, com uma
-- lista vazia — que descreve "funil sem etapas", não "não sei as etapas deste
-- funil". É a diferença entre ausência e desconhecimento, e ela chegou ao
-- integrador como um dropdown vazio.
--
-- Achado ao montar os dropdowns dinâmicos do app do Make: o seletor de Etapa
-- lê exatamente este payload.
--
-- `stage_key` para funil personalizado: a coluna existe em
-- `custom_pipeline_stages` e é o que `POST /deals` aceita em `stage`, então o
-- contrato público não muda de forma — só passa a vir preenchido.
-- ============================================================================

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
    'stages', CASE
      WHEN pip.type = 'system' THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('stage_key', ps.stage_key, 'name', ps.name,
          'color', ps.color, 'position', ps.position, 'is_active', ps.is_active,
          'is_final_positive', ps.is_final_positive, 'is_final_negative', ps.is_final_negative)
          ORDER BY ps.position)
        FROM pipeline_stages ps
        WHERE ps.organization_id = p_org AND ps.pipeline_type = pip.slug), '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object('stage_key', cs.stage_key, 'name', cs.name,
          'color', cs.color, 'position', cs.position, 'is_active', cs.is_active,
          'is_final_positive', cs.is_final_positive, 'is_final_negative', cs.is_final_negative)
          ORDER BY cs.position)
        FROM custom_pipeline_stages cs
        WHERE cs.organization_id = p_org AND cs.pipeline_id = pip.id), '[]'::jsonb)
    END
  ) ORDER BY pip.display_order), '[]'::jsonb)
  FROM pipelines pip WHERE pip.organization_id = p_org AND pip.is_active = true;
$$;

COMMENT ON FUNCTION public.api_list_pipelines(uuid) IS
  'GET /api/v1/pipelines. Etapas de funil de sistema vêm de pipeline_stages (por slug); de funil personalizado, de custom_pipeline_stages (por pipeline_id).';
