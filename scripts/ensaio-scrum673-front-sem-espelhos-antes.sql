-- Baseline pelos INSTEAD OF antigos. O runner anexa migration, comparação e ROLLBACK.
BEGIN;

CREATE TEMP TABLE _ensaio673_contexto (
  organization_id uuid NOT NULL,
  actor_id uuid,
  pipeline_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  atomic_pipeline_id uuid NOT NULL,
  pipeline_before jsonb NOT NULL,
  stage_before jsonb NOT NULL,
  trigger_defs_before jsonb NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_org uuid;
  v_actor uuid;
  v_pipeline uuid := gen_random_uuid();
  v_stage uuid := gen_random_uuid();
  v_atomic uuid := gen_random_uuid();
  v_pipeline_before jsonb;
  v_stage_before jsonb;
  v_trigger_defs jsonb;
BEGIN
  SELECT o.id, tm.id
    INTO v_org, v_actor
  FROM public.organizations o
  JOIN LATERAL (
    SELECT id FROM public.team_members
    WHERE organization_id = o.id AND is_active = true
    ORDER BY id LIMIT 1
  ) tm ON true
  WHERE 3 = (
    SELECT count(DISTINCT p.slug)
    FROM public.pipelines p
    WHERE p.organization_id = o.id
      AND p.type = 'system' -- metric-lint-allow: fixture operacional, não métrica
      AND p.slug IN ('whatsapp', 'confirmacao', 'propostas'))
  ORDER BY o.id
  LIMIT 1;

  IF v_org IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: falta organização com membro e três funis';
  END IF;

  INSERT INTO public.custom_pipelines (
    id, organization_id, name, slug, description, icon, color, position,
    is_active, created_by, created_at, updated_at, lifecycle_type, starts_at,
    ends_at, status, team_goal, individual_goal, bonus_value,
    bonus_description, objective_pipe_type, objective_stage_key, template_type,
    lead_source_config
  ) VALUES (
    v_pipeline, v_org, 'Ensaio SCRUM-673', 'ensaio-scrum-673', 'antes',
    'target', '#123456', 4, true, null,
    '2026-09-04 10:00:00+00', '2026-09-04 10:00:00+00',
    'temporary', '2026-09-05 10:00:00+00', '2026-09-10 10:00:00+00',
    'draft', 12, 3, 500, 'bônus', 'propostas', 'enviada', 'prospeccao',
    '{"origem":"ensaio"}'::jsonb
  );

  INSERT INTO public.custom_pipeline_stages (
    id, organization_id, pipeline_id, stage_key, name, color, position,
    is_active, is_final_positive, is_final_negative, target_pipeline_id,
    target_stage_id, target_pipe_type, target_stage_key, created_at, updated_at,
    checklist_template_id, stage_role, suggested_stage_role,
    stage_role_suggested_at, stage_role_suggestion_source,
    stage_role_reviewed_at, stage_role_reviewed_by, requires_sale_value
  ) VALUES (
    v_stage, v_org, v_pipeline, 'entrada', 'Entrada', '#654321', 2,
    true, false, false, null, null, 'confirmacao', 'marcada',
    '2026-09-04 10:00:00+00', '2026-09-04 10:00:00+00', null,
    'open', null, null, null, null, null, false
  );

  UPDATE public.custom_pipelines
     SET description = 'depois', status = 'paused', position = 7,
         lead_source_config = '{"origem":"ensaio","versao":2}'::jsonb
   WHERE id = v_pipeline;

  UPDATE public.custom_pipeline_stages
     SET name = 'Entrada revisada', color = '#abcdef', position = 5,
         target_pipe_type = null, target_stage_key = null,
         requires_sale_value = true
   WHERE id = v_stage;

  SELECT to_jsonb(p) - 'updated_at' INTO v_pipeline_before
  FROM public.pipelines p WHERE id = v_pipeline;
  SELECT to_jsonb(ps) - 'updated_at' INTO v_stage_before
  FROM public.pipeline_stages ps WHERE id = v_stage;

  SELECT jsonb_object_agg(proname, pg_get_functiondef(oid) ORDER BY proname)
    INTO v_trigger_defs
  FROM pg_proc
  WHERE oid IN (
    'public.custom_pipelines_insert_fn()'::regprocedure,
    'public.custom_pipelines_update_fn()'::regprocedure,
    'public.custom_pipeline_stages_insert_fn()'::regprocedure,
    'public.custom_pipeline_stages_update_fn()'::regprocedure
  );

  DELETE FROM public.custom_pipeline_stages WHERE id = v_stage;
  DELETE FROM public.custom_pipelines WHERE id = v_pipeline;

  INSERT INTO _ensaio673_contexto VALUES (
    v_org, v_actor, v_pipeline, v_stage, v_atomic,
    v_pipeline_before, v_stage_before, v_trigger_defs);
END;
$$;
