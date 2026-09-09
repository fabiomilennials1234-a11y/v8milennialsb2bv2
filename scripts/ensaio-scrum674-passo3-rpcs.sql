-- ANTES: executa oito caminhos pelas quatro RPCs ainda escritoras das views.
-- Nunca rodar sozinho. O shell anexa migration, asserções e ROLLBACK.

BEGIN;

CREATE TEMP TABLE _ensaio674_p3_contexto (
  chave text PRIMARY KEY,
  valor text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _ensaio674_p3_casos (
  caso text PRIMARY KEY,
  antes jsonb NOT NULL,
  depois jsonb
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.entrada674_snapshot(
  p_id uuid,
  p_expected_lead uuid,
  p_expected_deal uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT (
    to_jsonb(pe) - ARRAY[
      'id', 'created_at', 'updated_at', 'entered_at', 'stage_changed_at'
    ]::text[]
  ) || jsonb_build_object(
    -- IDs gerados mudam entre execuções. Normaliza somente quando a relação
    -- aponta para o objeto devolvido pela própria RPC; vínculo errado preserva
    -- UUID real e necessariamente diverge.
    'lead_id', CASE
      WHEN pe.lead_id = p_expected_lead THEN '__expected_lead__'
      ELSE pe.lead_id::text
    END,
    'deal_id', CASE
      WHEN pe.deal_id IS NOT DISTINCT FROM p_expected_deal
        THEN CASE WHEN p_expected_deal IS NULL THEN NULL ELSE '__expected_deal__' END
      ELSE pe.deal_id::text
    END
  )
  FROM public.pipeline_entries pe
  WHERE pe.id = p_id
$$;

-- create_lead_with_pipe já está quebrada em PROD por referenciar
-- leads.meeting_date, removida do schema. Neutraliza só essa coluna nos dois
-- lados do A/B; todo restante do corpo, inclusive os escritores, fica real.
CREATE FUNCTION pg_temp.neutralizar_meeting_date_create_lead_with_pipe()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_def text;
  v_patched text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_lead_with_pipe';

  IF v_def IS NULL
     OR strpos(v_def, 'meeting_date, compromisso_date,') = 0
     OR strpos(v_def, 'p_meeting_date, p_compromisso_date,') = 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: corpo de create_lead_with_pipe mudou; neutralização não é mais válida';
  END IF;

  v_patched := replace(v_def, 'meeting_date, compromisso_date,', 'compromisso_date,');
  v_patched := replace(v_patched, 'p_meeting_date, p_compromisso_date,', 'p_compromisso_date,');
  EXECUTE v_patched;
END;
$$;

DO $$
DECLARE
  candidato record;
  v_org uuid;
  v_actor uuid;
  v_user uuid;
  v_channel uuid;
  v_custom uuid;
  v_custom_stage uuid;
  v_stage_whatsapp text;
  v_stage_confirmacao text;
  v_stage_propostas text;
  v_lead uuid;
  v_deal uuid;
  v_entry uuid;
  v_result jsonb;
  v_nonce text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  -- Escolhe usuário real com os três funis de sistema, um custom e um canal.
  -- Claims são locais à transação; nenhuma sessão do pool herda identidade.
  FOR candidato IN
    SELECT tm.organization_id, tm.id AS actor_id, tm.user_id, mc.id AS channel_id
    FROM public.team_members tm
    JOIN LATERAL (
      SELECT id FROM public.messaging_channels
      WHERE organization_id = tm.organization_id
      ORDER BY created_at
      LIMIT 1
    ) mc ON true
    WHERE tm.is_active = true
      AND tm.user_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.pipelines p
        WHERE p.organization_id = tm.organization_id
          AND p.type = 'custom'
          AND p.is_active = true
          AND EXISTS (
            SELECT 1 FROM public.pipeline_stages ps
            WHERE ps.pipeline_id = p.id AND ps.is_active = true
          )
      )
      AND 3 = (
        SELECT count(DISTINCT p.slug)
        FROM public.pipelines p
        WHERE p.organization_id = tm.organization_id
          AND p.type = 'system' -- metric-lint-allow: fixture de escrita, não métrica
          AND p.slug IN ('whatsapp', 'confirmacao', 'propostas')
          AND p.is_active = true
      )
    ORDER BY (tm.role::text = 'admin') DESC, tm.created_at
  LOOP
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', candidato.user_id, 'role', 'authenticated')::text,
      true
    );
    IF COALESCE(public.has_feature_permission('leads.create', candidato.organization_id), false) THEN
      v_org := candidato.organization_id;
      v_actor := candidato.actor_id;
      v_user := candidato.user_id;
      v_channel := candidato.channel_id;
      EXIT;
    END IF;
  END LOOP;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: nenhuma fixture cobre org+ator+canal+funis+leads.create';
  END IF;

  SELECT p.id, ps.id
    INTO v_custom, v_custom_stage
  FROM public.pipelines p
  JOIN LATERAL (
    SELECT id FROM public.pipeline_stages
    WHERE pipeline_id = p.id AND is_active = true
    ORDER BY "position", id
    LIMIT 1
  ) ps ON true
  WHERE p.organization_id = v_org
    AND p.type = 'custom'
    AND p.is_active = true
  ORDER BY p.created_at, p.id
  LIMIT 1;

  SELECT ps.stage_key INTO v_stage_whatsapp
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.organization_id = v_org AND p.slug = 'whatsapp'
    AND p.type = 'system' -- metric-lint-allow: fixture de escrita, não métrica
    AND p.is_active = true AND ps.is_active = true
  ORDER BY ps."position", ps.id LIMIT 1;

  SELECT ps.stage_key INTO v_stage_confirmacao
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.organization_id = v_org AND p.slug = 'confirmacao'
    AND p.type = 'system' -- metric-lint-allow: fixture de escrita, não métrica
    AND p.is_active = true AND ps.is_active = true
  ORDER BY ps."position", ps.id LIMIT 1;

  SELECT ps.stage_key INTO v_stage_propostas
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.organization_id = v_org AND p.slug = 'propostas'
    AND p.type = 'system' -- metric-lint-allow: fixture de escrita, não métrica
    AND p.is_active = true AND ps.is_active = true
  ORDER BY ps."position", ps.id LIMIT 1;

  IF v_custom_stage IS NULL OR v_stage_whatsapp IS NULL
     OR v_stage_confirmacao IS NULL OR v_stage_propostas IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: fixture sem alguma etapa ativa';
  END IF;

  INSERT INTO _ensaio674_p3_contexto(chave, valor) VALUES
    ('org', v_org::text), ('actor', v_actor::text), ('user', v_user::text),
    ('channel', v_channel::text), ('custom', v_custom::text),
    ('custom_stage', v_custom_stage::text), ('stage_whatsapp', v_stage_whatsapp),
    ('stage_confirmacao', v_stage_confirmacao), ('stage_propostas', v_stage_propostas),
    ('nonce', v_nonce);

  INSERT INTO _ensaio674_p3_contexto(chave, valor)
  SELECT 'acl:' || p.proname,
         COALESCE(p.proacl::text, '<null>') || '|' || p.prosecdef::text || '|' || COALESCE(p.proconfig::text, '<null>')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'abrir_negocio', 'create_lead_with_pipe',
      'create_lead_from_social_conversation', 'import_lead_into_custom_pipeline'
    );

  PERFORM pg_temp.neutralizar_meeting_date_create_lead_with_pipe();
  PERFORM set_config('app.skip_default_pipe', '1', true);
  INSERT INTO public.leads(organization_id, name, origin)
  VALUES (v_org, 'ensaio674 abrir antes ' || v_nonce, 'outro')
  RETURNING id INTO v_lead;

  v_deal := public.abrir_negocio(
    v_lead, 'whatsapp', v_stage_whatsapp, v_actor, 674.01,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  INSERT INTO _ensaio674_p3_casos VALUES ('abrir_whatsapp', pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal), NULL);

  v_deal := public.abrir_negocio(
    v_lead, 'confirmacao', v_stage_confirmacao, v_actor, 674.02,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  INSERT INTO _ensaio674_p3_casos VALUES ('abrir_confirmacao', pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal), NULL);

  v_deal := public.abrir_negocio(
    v_lead, 'propostas', v_stage_propostas, v_actor, 674.03,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  INSERT INTO _ensaio674_p3_casos VALUES ('abrir_propostas', pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal), NULL);

  v_deal := public.abrir_negocio(
    v_lead, v_custom::text, v_custom_stage::text, v_actor, 674.04,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  INSERT INTO _ensaio674_p3_casos VALUES ('abrir_custom', pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal), NULL);

  v_result := public.create_lead_with_pipe(
    p_name => 'ensaio674 create whatsapp antes ' || v_nonce,
    p_organization_id => v_org,
    p_sdr_id => v_actor,
    p_closer_id => v_actor,
    p_responsible_id => v_actor,
    p_pipe_type => 'whatsapp',
    p_pipe_status => v_stage_whatsapp,
    p_pipe_responsible_id => v_actor);
  v_entry := (v_result->>'pipe_id')::uuid;
  INSERT INTO _ensaio674_p3_casos VALUES (
    'create_whatsapp',
    pg_temp.entrada674_snapshot(v_entry, (v_result->>'lead_id')::uuid),
    NULL);

  v_result := public.create_lead_with_pipe(
    p_name => 'ensaio674 create confirmacao antes ' || v_nonce,
    p_organization_id => v_org,
    p_sdr_id => v_actor,
    p_closer_id => v_actor,
    p_responsible_id => v_actor,
    p_pipe_type => 'confirmacao',
    p_pipe_status => v_stage_confirmacao,
    p_pipe_meeting_date => '2026-09-04 12:00:00+00',
    p_meet_link => 'https://example.invalid/ensaio674',
    p_pipe_responsible_id => v_actor);
  v_entry := (v_result->>'pipe_id')::uuid;
  INSERT INTO _ensaio674_p3_casos VALUES (
    'create_confirmacao',
    pg_temp.entrada674_snapshot(v_entry, (v_result->>'lead_id')::uuid),
    NULL);

  v_lead := public.create_lead_from_social_conversation(
    p_org => v_org,
    p_channel => v_channel,
    p_external_user_id => 'ensaio674-antes-' || v_nonce,
    p_name => 'ensaio674 social antes ' || v_nonce,
    p_destination => 'custom',
    p_custom_pipeline_id => v_custom,
    p_custom_stage_id => v_custom_stage);
  SELECT id INTO v_entry FROM public.pipeline_entries
  WHERE lead_id = v_lead AND pipeline_id = v_custom;
  INSERT INTO _ensaio674_p3_casos VALUES ('social_custom', pg_temp.entrada674_snapshot(v_entry, v_lead), NULL);

  v_lead := public.import_lead_into_custom_pipeline(
    v_org,
    jsonb_build_object('name', 'ensaio674 import antes ' || v_nonce, 'origin', 'outro', 'rating', 3),
    v_custom,
    v_custom_stage,
    v_actor);
  SELECT id INTO v_entry FROM public.pipeline_entries
  WHERE lead_id = v_lead AND pipeline_id = v_custom;
  INSERT INTO _ensaio674_p3_casos VALUES ('import_custom', pg_temp.entrada674_snapshot(v_entry, v_lead), NULL);

  IF (SELECT count(*) FROM _ensaio674_p3_casos) <> 8 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: esperado 8 retratos antes';
  END IF;

  RAISE NOTICE 'ANTES capturado: 8 caminhos, org %, ator %', v_org, v_actor;
END $$;
