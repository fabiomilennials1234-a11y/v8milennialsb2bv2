-- ANTES: monta fixture descartável e executa o trigger ainda escritor das views.
-- Nunca rodar sozinho. O shell anexa migration, asserções e ROLLBACK.

BEGIN;

CREATE TEMP TABLE _ensaio674_p3t_contexto (
  organization_id uuid NOT NULL,
  actor_old uuid NOT NULL,
  actor_new uuid NOT NULL,
  lead_id uuid NOT NULL,
  campanha_lead_id uuid NOT NULL,
  function_def text NOT NULL,
  function_comment text,
  function_state text NOT NULL,
  trigger_state text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _ensaio674_p3t_original_entries
ON COMMIT DROP
AS SELECT pe.*
FROM public.pipeline_entries pe
WHERE false;

CREATE TEMP TABLE _ensaio674_p3t_original_campanha
ON COMMIT DROP
AS SELECT cl.*
FROM public.campanha_leads cl
WHERE false;

CREATE TEMP TABLE _ensaio674_p3t_resultado (
  id boolean PRIMARY KEY DEFAULT true,
  antes jsonb NOT NULL,
  depois jsonb
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.snapshot674_trigger(p_lead uuid, p_campanha_lead uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'entries',
    (
      SELECT jsonb_object_agg(
        pip.slug,
        to_jsonb(pe) - ARRAY['created_at', 'updated_at']::text[]
        ORDER BY pip.slug)
      FROM public.pipeline_entries pe
      JOIN public.pipelines pip ON pip.id = pe.pipeline_id
      WHERE pe.lead_id = p_lead
        AND pip.type = 'system' -- metric-lint-allow: fixture de equivalência, não métrica
        AND pip.slug IN ('whatsapp', 'confirmacao', 'propostas')
    ),
    'campanha_lead',
    (
      SELECT to_jsonb(cl) - ARRAY['created_at', 'updated_at']::text[]
      FROM public.campanha_leads cl
      WHERE cl.id = p_campanha_lead
    )
  )
$$;

DO $$
DECLARE
  v_org uuid;
  v_actor_old uuid;
  v_actor_new uuid;
  v_lead uuid;
  v_campanha uuid;
  v_campanha_stage uuid;
  v_campanha_lead uuid;
  v_stage_whatsapp text;
  v_stage_confirmacao text;
  v_stage_propostas text;
  v_function_def text;
  v_function_comment text;
  v_function_state text;
  v_trigger_state text;
  v_entry uuid;
BEGIN
  SELECT candidate.organization_id,
         candidate.actor_old,
         candidate.actor_new,
         candidate.campanha_id,
         candidate.campanha_stage_id
    INTO v_org, v_actor_old, v_actor_new, v_campanha, v_campanha_stage
  FROM (
    SELECT members.organization_id,
           members.actors[1] AS actor_old,
           members.actors[2] AS actor_new,
           campaign.id AS campanha_id,
           campaign.stage_id AS campanha_stage_id
    FROM (
      SELECT tm.organization_id,
             array_agg(tm.id ORDER BY tm.id) AS actors
      FROM public.team_members tm
      WHERE tm.is_active = true
      GROUP BY tm.organization_id
      HAVING count(*) >= 2
    ) members
    JOIN LATERAL (
      SELECT c.id, cs.id AS stage_id
      FROM public.campanhas c
      JOIN public.campanha_stages cs ON cs.campanha_id = c.id
      WHERE c.organization_id = members.organization_id
      ORDER BY c.id, cs.id
      LIMIT 1
    ) campaign ON true
    WHERE 3 = (
      SELECT count(DISTINCT p.slug)
      FROM public.pipelines p
      WHERE p.organization_id = members.organization_id
        AND p.type = 'system' -- metric-lint-allow: fixture de equivalência, não métrica
        AND p.slug IN ('whatsapp', 'confirmacao', 'propostas')
    )
    ORDER BY members.organization_id
    LIMIT 1
  ) candidate;

  IF v_org IS NULL OR v_actor_old = v_actor_new THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: falta org com dois membros, campanha e três funis';
  END IF;

  SELECT ps.stage_key INTO v_stage_whatsapp
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.organization_id = v_org
    AND p.type = 'system' -- metric-lint-allow: fixture de equivalência, não métrica
    AND p.slug = 'whatsapp'
  ORDER BY ps."position", ps.id
  LIMIT 1;

  SELECT ps.stage_key INTO v_stage_confirmacao
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.organization_id = v_org
    AND p.type = 'system' -- metric-lint-allow: fixture de equivalência, não métrica
    AND p.slug = 'confirmacao'
  ORDER BY ps."position", ps.id
  LIMIT 1;

  SELECT ps.stage_key INTO v_stage_propostas
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.organization_id = v_org
    AND p.type = 'system' -- metric-lint-allow: fixture de equivalência, não métrica
    AND p.slug = 'propostas'
  ORDER BY ps."position", ps.id
  LIMIT 1;

  IF v_stage_whatsapp IS NULL OR v_stage_confirmacao IS NULL OR v_stage_propostas IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: funil de sistema sem etapa';
  END IF;

  SELECT pg_get_functiondef(p.oid),
         obj_description(p.oid, 'pg_proc'),
         COALESCE(p.proacl::text, '<null>') || '|' || p.prosecdef::text || '|' || COALESCE(p.proconfig::text, '<null>')
    INTO v_function_def, v_function_comment, v_function_state
  FROM pg_proc p
  WHERE p.oid = 'public.sync_responsible_from_lead_to_pipes()'::regprocedure;

  SELECT t.tgenabled::text || '|' || pg_get_triggerdef(t.oid, true)
    INTO v_trigger_state
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.leads'::regclass
    AND t.tgname = 'trg_sync_responsible_from_lead_to_pipes'
    AND NOT t.tgisinternal;

  PERFORM set_config('app.skip_default_pipe', '1', true);

  INSERT INTO public.leads(
    organization_id, name, origin, responsible_id, closer_id, sdr_id)
  VALUES (
    v_org, 'ensaio SCRUM-674 trigger ' || gen_random_uuid()::text, 'outro',
    v_actor_old, v_actor_old, v_actor_old)
  RETURNING id INTO v_lead;

  v_entry := public.fn_entrada_sistema_criar(
    p_organization_id => v_org,
    p_slug => 'whatsapp',
    p_lead_id => v_lead,
    p_stage_key => v_stage_whatsapp,
    p_assigned_to => v_actor_old,
    p_pre_sale_responsible_id => v_actor_old,
    p_sale_responsible_id => v_actor_old,
    p_metadata => jsonb_build_object(
      'responsible_id', v_actor_old,
      'sdr_id', v_actor_old,
      'scheduled_date', '2026-09-04 15:00:00+00'::timestamptz),
    p_notes => 'whatsapp');

  -- Deixa uma linha esparsa. O UPDATE pela view materializa estas chaves como
  -- nulo explícito; o caminho novo precisa fazer exatamente o mesmo.
  UPDATE public.pipeline_entries
     SET metadata = metadata - ARRAY[
       'pre_sale_responsible_id', 'sale_responsible_id', 'scheduled_date'
     ]::text[]
   WHERE id = v_entry;

  v_entry := public.fn_entrada_sistema_criar(
    p_organization_id => v_org,
    p_slug => 'confirmacao',
    p_lead_id => v_lead,
    p_stage_key => v_stage_confirmacao,
    p_assigned_to => v_actor_old,
    p_pre_sale_responsible_id => v_actor_old,
    p_sale_responsible_id => v_actor_old,
    p_metadata => jsonb_build_object(
      'meeting_date', '2026-09-04 16:00:00+00'::timestamptz,
      'is_confirmed', true,
      'closer_id', v_actor_old,
      'responsible_id', v_actor_old,
      'sdr_id', v_actor_old,
      'meet_link', 'https://example.invalid/scrum674',
      'metrics_period_at', '2026-09-01 00:00:00+00'::timestamptz),
    p_notes => 'confirmacao');

  v_entry := public.fn_entrada_sistema_criar(
    p_organization_id => v_org,
    p_slug => 'propostas',
    p_lead_id => v_lead,
    p_stage_key => v_stage_propostas,
    p_assigned_to => v_actor_old,
    p_pre_sale_responsible_id => v_actor_old,
    p_sale_responsible_id => v_actor_old,
    p_metadata => jsonb_build_object(
      'sale_value', 674.50,
      'closer_id', v_actor_old,
      'responsible_id', v_actor_old,
      'product_id', NULL,
      'product_type', 'ensaio',
      'calor', 3,
      'loss_reason', NULL,
      'loss_reason_id', NULL,
      'commitment_date', '2026-09-10'::date,
      'contract_duration', 12,
      'metrics_period_at', '2026-09-01 00:00:00+00'::timestamptz),
    p_notes => 'propostas');

  INSERT INTO public.campanha_leads(
    campanha_id, lead_id, stage_id, sdr_id, closer_id, responsible_id,
    pre_sale_responsible_id, sale_responsible_id)
  VALUES (
    v_campanha, v_lead, v_campanha_stage, v_actor_old, v_actor_old,
    v_actor_old, v_actor_old, v_actor_old)
  RETURNING id INTO v_campanha_lead;

  INSERT INTO _ensaio674_p3t_original_entries
  SELECT pe.* FROM public.pipeline_entries pe WHERE pe.lead_id = v_lead;

  INSERT INTO _ensaio674_p3t_original_campanha
  SELECT cl.* FROM public.campanha_leads cl WHERE cl.id = v_campanha_lead;

  INSERT INTO _ensaio674_p3t_contexto VALUES (
    v_org, v_actor_old, v_actor_new, v_lead, v_campanha_lead,
    v_function_def, v_function_comment, v_function_state, v_trigger_state);

  UPDATE public.leads
     SET responsible_id = v_actor_new,
         closer_id = v_actor_new,
         sdr_id = v_actor_new
   WHERE id = v_lead;

  INSERT INTO _ensaio674_p3t_resultado(antes)
  VALUES (pg_temp.snapshot674_trigger(v_lead, v_campanha_lead));

  -- Volta a fixture ao byte original. A primeira escrita usa o próprio trigger
  -- velho para recompor o lead; depois restauramos só as três colunas que ele
  -- tocou nas entries. Tudo segue na transação e termina em ROLLBACK.
  UPDATE public.leads
     SET responsible_id = v_actor_old,
         closer_id = v_actor_old,
         sdr_id = v_actor_old
   WHERE id = v_lead;

  UPDATE public.pipeline_entries pe
     SET assigned_to = src.assigned_to,
         metadata = src.metadata,
         updated_at = src.updated_at
    FROM _ensaio674_p3t_original_entries src
   WHERE pe.id = src.id;

  UPDATE public.campanha_leads cl
     SET responsible_id = src.responsible_id,
         updated_at = src.updated_at
    FROM _ensaio674_p3t_original_campanha src
   WHERE cl.id = src.id;

END;
$$;
