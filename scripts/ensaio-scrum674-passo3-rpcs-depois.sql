-- DEPOIS: repete mesmos oito caminhos com os corpos novos e compara registro inteiro.

CREATE FUNCTION pg_temp.assert_entradas674_identicas()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  caso_row record;
  v_divergencias integer := 0;
  v_relato text := '';
BEGIN
  FOR caso_row IN SELECT * FROM _ensaio674_p3_casos ORDER BY caso LOOP
    IF md5(caso_row.antes::text) IS DISTINCT FROM md5(caso_row.depois::text) THEN
      v_divergencias := v_divergencias + 1;
      v_relato := v_relato || format(E'\n%s\nantes=%s\ndepois=%s', caso_row.caso, caso_row.antes, caso_row.depois);
    END IF;
  END LOOP;

  IF v_divergencias > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P6741',
      MESSAGE = format('REPROVOU: %s divergências:%s', v_divergencias, v_relato);
  END IF;
END;
$$;

DO $$
DECLARE
  v_org uuid := (SELECT valor::uuid FROM _ensaio674_p3_contexto WHERE chave = 'org');
  v_actor uuid := (SELECT valor::uuid FROM _ensaio674_p3_contexto WHERE chave = 'actor');
  v_user uuid := (SELECT valor::uuid FROM _ensaio674_p3_contexto WHERE chave = 'user');
  v_channel uuid := (SELECT valor::uuid FROM _ensaio674_p3_contexto WHERE chave = 'channel');
  v_custom uuid := (SELECT valor::uuid FROM _ensaio674_p3_contexto WHERE chave = 'custom');
  v_custom_stage uuid := (SELECT valor::uuid FROM _ensaio674_p3_contexto WHERE chave = 'custom_stage');
  v_stage_whatsapp text := (SELECT valor FROM _ensaio674_p3_contexto WHERE chave = 'stage_whatsapp');
  v_stage_confirmacao text := (SELECT valor FROM _ensaio674_p3_contexto WHERE chave = 'stage_confirmacao');
  v_stage_propostas text := (SELECT valor FROM _ensaio674_p3_contexto WHERE chave = 'stage_propostas');
  v_nonce text := (SELECT valor FROM _ensaio674_p3_contexto WHERE chave = 'nonce');
  v_lead uuid;
  v_deal uuid;
  v_entry uuid;
  v_result jsonb;
  fn_row record;
  v_foreign_actor uuid;
  v_foreign_pipeline uuid;
  v_foreign_stage uuid;
  v_unauthorized_user uuid := gen_random_uuid();
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('app.skip_default_pipe', '1', true);

  -- Mesma neutralização aplicada ao corpo velho: remove só defeito externo à
  -- SCRUM-674 para permitir comparar os dois escritores reais da RPC.
  PERFORM pg_temp.neutralizar_meeting_date_create_lead_with_pipe();

  IF (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'abrir_negocio', 'create_lead_with_pipe',
        'create_lead_from_social_conversation', 'import_lead_into_custom_pipeline'
      )
      AND p.prosrc LIKE '%fn_entrada_%_criar%'
  ) <> 4 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: migration não fez as quatro RPCs delegarem';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'abrir_negocio', 'create_lead_with_pipe',
        'create_lead_from_social_conversation', 'import_lead_into_custom_pipeline'
      )
      AND (
        p.prosrc ILIKE '%INSERT INTO public.pipe_whatsapp%'
        OR p.prosrc ILIKE '%INSERT INTO public.pipe_confirmacao%'
        OR p.prosrc ILIKE '%INSERT INTO public.pipe_propostas%'
        OR p.prosrc ILIKE '%INSERT INTO public.custom_pipe_entries%'
      )
  ) THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: alguma RPC ainda escreve por view';
  END IF;

  FOR fn_row IN
    SELECT p.proname,
           COALESCE(p.proacl::text, '<null>') || '|' || p.prosecdef::text || '|' || COALESCE(p.proconfig::text, '<null>') AS estado
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'abrir_negocio', 'create_lead_with_pipe',
        'create_lead_from_social_conversation', 'import_lead_into_custom_pipeline'
      )
  LOOP
    IF fn_row.estado IS DISTINCT FROM (
      SELECT valor FROM _ensaio674_p3_contexto WHERE chave = 'acl:' || fn_row.proname
    ) THEN
      RAISE EXCEPTION 'ENSAIO ABORTADO: ACL/security/search_path mudou em %', fn_row.proname;
    END IF;
  END LOOP;

  INSERT INTO public.leads(organization_id, name, origin)
  VALUES (v_org, 'ensaio674 abrir depois ' || v_nonce, 'outro')
  RETURNING id INTO v_lead;

  v_deal := public.abrir_negocio(
    v_lead, 'whatsapp', v_stage_whatsapp, v_actor, 674.01,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  UPDATE _ensaio674_p3_casos SET depois = pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal) WHERE caso = 'abrir_whatsapp';

  v_deal := public.abrir_negocio(
    v_lead, 'confirmacao', v_stage_confirmacao, v_actor, 674.02,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  UPDATE _ensaio674_p3_casos SET depois = pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal) WHERE caso = 'abrir_confirmacao';

  v_deal := public.abrir_negocio(
    v_lead, 'propostas', v_stage_propostas, v_actor, 674.03,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  UPDATE _ensaio674_p3_casos SET depois = pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal) WHERE caso = 'abrir_propostas';

  v_deal := public.abrir_negocio(
    v_lead, v_custom::text, v_custom_stage::text, v_actor, 674.04,
    '2026-09-04 12:00:00+00', 'ensaio674', 'ensaio674', 'api');
  SELECT id INTO v_entry FROM public.pipeline_entries WHERE deal_id = v_deal;
  UPDATE _ensaio674_p3_casos SET depois = pg_temp.entrada674_snapshot(v_entry, v_lead, v_deal) WHERE caso = 'abrir_custom';

  v_result := public.create_lead_with_pipe(
    p_name => 'ensaio674 create whatsapp depois ' || v_nonce,
    p_organization_id => v_org,
    p_sdr_id => v_actor,
    p_closer_id => v_actor,
    p_responsible_id => v_actor,
    p_pipe_type => 'whatsapp',
    p_pipe_status => v_stage_whatsapp,
    p_pipe_responsible_id => v_actor);
  v_entry := (v_result->>'pipe_id')::uuid;
  UPDATE _ensaio674_p3_casos
  SET depois = pg_temp.entrada674_snapshot(v_entry, (v_result->>'lead_id')::uuid)
  WHERE caso = 'create_whatsapp';

  v_result := public.create_lead_with_pipe(
    p_name => 'ensaio674 create confirmacao depois ' || v_nonce,
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
  UPDATE _ensaio674_p3_casos
  SET depois = pg_temp.entrada674_snapshot(v_entry, (v_result->>'lead_id')::uuid)
  WHERE caso = 'create_confirmacao';

  v_lead := public.create_lead_from_social_conversation(
    p_org => v_org,
    p_channel => v_channel,
    p_external_user_id => 'ensaio674-depois-' || v_nonce,
    p_name => 'ensaio674 social depois ' || v_nonce,
    p_destination => 'custom',
    p_custom_pipeline_id => v_custom,
    p_custom_stage_id => v_custom_stage);
  SELECT id INTO v_entry FROM public.pipeline_entries
  WHERE lead_id = v_lead AND pipeline_id = v_custom;
  UPDATE _ensaio674_p3_casos SET depois = pg_temp.entrada674_snapshot(v_entry, v_lead) WHERE caso = 'social_custom';

  v_lead := public.import_lead_into_custom_pipeline(
    v_org,
    jsonb_build_object('name', 'ensaio674 import depois ' || v_nonce, 'origin', 'outro', 'rating', 3),
    v_custom,
    v_custom_stage,
    v_actor);
  SELECT id INTO v_entry FROM public.pipeline_entries
  WHERE lead_id = v_lead AND pipeline_id = v_custom;
  UPDATE _ensaio674_p3_casos SET depois = pg_temp.entrada674_snapshot(v_entry, v_lead) WHERE caso = 'import_custom';

  IF EXISTS (SELECT 1 FROM _ensaio674_p3_casos WHERE depois IS NULL) THEN
    RAISE EXCEPTION 'REPROVOU: algum caminho novo não criou entrada';
  END IF;

  -- Negativos: cada RPC continua recusando uma fronteira de tenant antes de
  -- qualquer escrita. Corpos de gate não mudaram; isto prova que a nova chamada
  -- não abriu atalho ao trocar view por função compartilhada.
  SELECT id INTO v_foreign_actor
  FROM public.team_members
  WHERE organization_id <> v_org
  ORDER BY created_at, id
  LIMIT 1;

  SELECT p.id, ps.id INTO v_foreign_pipeline, v_foreign_stage
  FROM public.pipelines p
  JOIN LATERAL (
    SELECT id FROM public.pipeline_stages
    WHERE pipeline_id = p.id
    ORDER BY "position", id
    LIMIT 1
  ) ps ON true
  WHERE p.organization_id <> v_org AND p.type = 'custom'
  ORDER BY p.created_at, p.id
  LIMIT 1;

  IF v_foreign_actor IS NULL OR v_foreign_pipeline IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: falta fixture estrangeira para negativos de tenancy';
  END IF;

  BEGIN
    PERFORM public.abrir_negocio(
      v_lead, 'whatsapp', v_stage_whatsapp, v_foreign_actor,
      674.99, NULL, 'ensaio674-negativo', 'ensaio674-negativo', 'api');
    RAISE EXCEPTION 'REPROVOU: abrir_negocio aceitou responsável de outra org';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK negativo abrir_negocio: responsável estrangeiro recusado';
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_unauthorized_user, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.create_lead_with_pipe(
      p_name => 'ensaio674 não autorizado',
      p_organization_id => v_org);
    RAISE EXCEPTION 'REPROVOU: create_lead_with_pipe aceitou caller sem org';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'access_denied' THEN RAISE; END IF;
    RAISE NOTICE 'OK negativo create_lead_with_pipe: caller sem org recusado';
  END;

  BEGIN
    PERFORM public.create_lead_from_social_conversation(
      p_org => v_org,
      p_channel => v_channel,
      p_external_user_id => 'ensaio674-negativo-' || v_nonce,
      p_name => 'ensaio674 não autorizado');
    RAISE EXCEPTION 'REPROVOU: create_lead_from_social_conversation aceitou caller sem org';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK negativo social: caller sem org recusado';
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.import_lead_into_custom_pipeline(
      v_org,
      jsonb_build_object('name', 'ensaio674 pipeline estrangeiro', 'origin', 'outro'),
      v_foreign_pipeline,
      v_foreign_stage,
      NULL);
    RAISE EXCEPTION 'REPROVOU: import aceitou pipeline de outra org';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'Pipeline custom % não pertence à organização %' THEN RAISE; END IF;
    RAISE NOTICE 'OK negativo import: pipeline estrangeiro recusado';
  END;

  -- Controle positivo: envenena a tabela real e chama o MESMO comparador usado
  -- na aprovação. A exceção reverte o veneno dentro desta subtransação.
  BEGIN
    UPDATE _ensaio674_p3_casos
    SET depois = depois || jsonb_build_object('_veneno', true)
    WHERE caso = (SELECT min(caso) FROM _ensaio674_p3_casos);
    PERFORM pg_temp.assert_entradas674_identicas();
    RAISE EXCEPTION 'REPROVOU: controle positivo não detectou veneno';
  EXCEPTION WHEN SQLSTATE 'P6741' THEN
    RAISE NOTICE 'OK controle positivo: divergência artificial detectada';
  END;

  PERFORM pg_temp.assert_entradas674_identicas();
  RAISE NOTICE 'OK 8/8 caminhos: registros idênticos';

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-674 passo 3 janela 1: 8/8 caminhos idênticos sob neutralização simétrica de meeting_date; ACLs intactas; 4 RPCs sem escrita por view';
END $$;

ROLLBACK;
