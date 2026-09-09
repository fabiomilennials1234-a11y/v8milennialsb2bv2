-- SCRUM-674 follow-up: prevent invisible cards in system pipelines.
--
-- A system entry previously accepted any stage_key. The stage mirror then
-- resolved inactive stages and left unknown stages with stage_id NULL. Both
-- cases create cards that the active-stage Kanban cannot render.

CREATE OR REPLACE FUNCTION public.fn_entrada_sistema_criar(
  p_organization_id         uuid,
  p_slug                    text,
  p_lead_id                 uuid,
  p_stage_key               text        DEFAULT NULL,
  p_assigned_to             uuid        DEFAULT NULL,
  p_pre_sale_responsible_id uuid        DEFAULT NULL,
  p_sale_responsible_id     uuid        DEFAULT NULL,
  p_metadata                jsonb       DEFAULT '{}'::jsonb,
  p_notes                   text        DEFAULT NULL,
  p_closed_at               timestamptz DEFAULT NULL,
  p_id                      uuid        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pipe        public.pipelines%ROWTYPE;
  v_pipeline_id uuid;
  v_stage_id    uuid;
  v_stage_key   text;
  v_id          uuid;
BEGIN
  IF p_slug NOT IN ('whatsapp', 'confirmacao', 'propostas') THEN
    RAISE EXCEPTION 'fn_entrada_sistema_criar: slug % não é funil de sistema', p_slug;
  END IF;

  BEGIN
    v_pipe := public.fn_resolver_funil(p_organization_id, p_slug);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Pipeline % not found for org %', p_slug, p_organization_id;
  END;

  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'Pipeline % not found for org %', p_slug, p_organization_id;
  END IF;

  -- metric-lint-allow: this is a system-pipeline write invariant, not a metric filter.
  IF v_pipe.type IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'fn_entrada_sistema_criar: funil % da org % não é de sistema (type=%)',
      p_slug, p_organization_id, v_pipe.type;
  END IF;

  v_pipeline_id := v_pipe.id;
  v_stage_key := COALESCE(p_stage_key, CASE p_slug
    WHEN 'whatsapp'    THEN 'novo_lead'
    WHEN 'confirmacao' THEN 'marcada'
    WHEN 'propostas'   THEN 'enviada'
  END);

  -- Honor a requested stage only while it is active. Otherwise choose the
  -- first active stage deterministically. A pipeline with no active stage is
  -- not writable because any resulting card would be invisible.
  SELECT ps.id, ps.stage_key
    INTO v_stage_id, v_stage_key
    FROM public.pipeline_stages ps
   WHERE ps.organization_id = p_organization_id
     AND ps.pipeline_id = v_pipeline_id
     AND ps.stage_key = v_stage_key
     AND ps.is_active = true
   ORDER BY ps.position NULLS LAST, ps.id
   LIMIT 1;

  IF v_stage_id IS NULL THEN
    SELECT ps.id, ps.stage_key
      INTO v_stage_id, v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = p_organization_id
       AND ps.pipeline_id = v_pipeline_id
       AND ps.is_active = true
     ORDER BY ps.position NULLS LAST, ps.id
     LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_sistema_criar: funil % da org % não possui etapa ativa',
      p_slug, p_organization_id;
  END IF;

  PERFORM public.fn_assert_member_in_org(p_pre_sale_responsible_id, p_organization_id, 'pre_sale_responsible_id');
  PERFORM public.fn_assert_member_in_org(p_sale_responsible_id, p_organization_id, 'sale_responsible_id');

  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_id, stage_key, assigned_to, metadata, notes, closed_at)
  VALUES (
    v_id, p_lead_id, p_organization_id, v_pipeline_id, v_stage_id, v_stage_key,
    p_assigned_to,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'pre_sale_responsible_id', p_pre_sale_responsible_id,
      'sale_responsible_id',     p_sale_responsible_id),
    p_notes, p_closed_at
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_entrada_sistema_criar IS
  'SCRUM-674: cria entrada em funil de sistema somente em etapa ativa; pedido inválido cai na primeira etapa ativa e funil sem etapa ativa rejeita a escrita.';

REVOKE ALL ON FUNCTION public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid) TO authenticated, service_role;
