-- DEPOIS: executa a mesma mudança pelo corpo novo e compara a linha inteira.

DO $$
DECLARE
  ctx _ensaio674_p3t_contexto%ROWTYPE;
  v_after jsonb;
  v_poison jsonb;
  v_writer_count integer;
  v_function_state text;
  v_trigger_state text;
BEGIN
  SELECT * INTO ctx FROM _ensaio674_p3t_contexto;

  IF (
    SELECT strpos(p.prosrc, 'fn_entrada_sistema_atualizar')
    FROM pg_proc p
    WHERE p.oid = 'public.sync_responsible_from_lead_to_pipes()'::regprocedure
  ) = 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: trigger novo não delega à função compartilhada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = 'public.sync_responsible_from_lead_to_pipes()'::regprocedure
      AND (
        p.prosrc ILIKE '%UPDATE public.pipe_whatsapp%'
        OR p.prosrc ILIKE '%UPDATE public.pipe_confirmacao%'
        OR p.prosrc ILIKE '%UPDATE public.pipe_propostas%'
      )
  ) THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: trigger novo ainda escreve pelos espelhos';
  END IF;

  SELECT count(*) INTO v_writer_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.prosrc ~* '(insert[[:space:]]+into|update)[[:space:]]+public[.]pipe_(whatsapp|confirmacao|propostas)'
      OR p.prosrc ~* '(insert[[:space:]]+into|update)[[:space:]]+public[.]custom_pipe_(entries|stages|pipelines)'
    );

  IF v_writer_count <> 0 THEN
    RAISE EXCEPTION 'REPROVOU: % função(ões) SQL ainda escrevem pelos espelhos', v_writer_count;
  END IF;

  SELECT COALESCE(p.proacl::text, '<null>') || '|' || p.prosecdef::text || '|' || COALESCE(p.proconfig::text, '<null>')
    INTO v_function_state
  FROM pg_proc p
  WHERE p.oid = 'public.sync_responsible_from_lead_to_pipes()'::regprocedure;

  IF v_function_state IS DISTINCT FROM ctx.function_state THEN
    RAISE EXCEPTION 'REPROVOU: ACL/SECURITY/search_path mudou: antes=%, depois=%',
      ctx.function_state, v_function_state;
  END IF;

  SELECT t.tgenabled::text || '|' || pg_get_triggerdef(t.oid, true)
    INTO v_trigger_state
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.leads'::regclass
    AND t.tgname = 'trg_sync_responsible_from_lead_to_pipes'
    AND NOT t.tgisinternal;

  IF v_trigger_state IS DISTINCT FROM ctx.trigger_state THEN
    RAISE EXCEPTION 'REPROVOU: estado/definição do trigger mudou';
  END IF;

  UPDATE public.leads
     SET responsible_id = ctx.actor_new,
         closer_id = ctx.actor_new,
         sdr_id = ctx.actor_new
   WHERE id = ctx.lead_id;

  v_after := pg_temp.snapshot674_trigger(ctx.lead_id, ctx.campanha_lead_id);
  UPDATE _ensaio674_p3t_resultado SET depois = v_after;

  IF (
    SELECT md5(antes::text) IS DISTINCT FROM md5(depois::text)
    FROM _ensaio674_p3t_resultado
  ) THEN
    RAISE EXCEPTION 'REPROVOU: saída divergiu.%', (
      SELECT format(E'\nantes=%s\ndepois=%s', antes, depois)
      FROM _ensaio674_p3t_resultado);
  END IF;

  IF (
    SELECT responsible_id FROM public.campanha_leads
    WHERE id = ctx.campanha_lead_id
  ) IS DISTINCT FROM ctx.actor_new THEN
    RAISE EXCEPTION 'REPROVOU: campanha_leads deixou de acompanhar responsible_id';
  END IF;

  -- Controle positivo: envenena assigned_to de propostas e exige divergência.
  UPDATE public.pipeline_entries pe
     SET assigned_to = ctx.actor_old
    FROM public.pipelines pip
   WHERE pip.id = pe.pipeline_id
     AND pe.lead_id = ctx.lead_id
     AND pip.slug = 'propostas'
     AND pip.type = 'system'; -- metric-lint-allow: controle positivo, não métrica

  v_poison := pg_temp.snapshot674_trigger(ctx.lead_id, ctx.campanha_lead_id);
  IF (
    SELECT md5(antes::text) IS NOT DISTINCT FROM md5(v_poison::text)
    FROM _ensaio674_p3t_resultado
  ) THEN
    RAISE EXCEPTION 'REPROVOU: controle positivo não detectou assigned_to divergente';
  END IF;

  RAISE NOTICE 'ENSAIO_OK SCRUM-674 passo 3 janela 2: A/B idêntico, writer_count=0, ACL e trigger preservados, controle positivo detectou owner divergente';
END;
$$;

ROLLBACK;
