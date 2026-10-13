-- Rollback of 20271119000000_um_card_sem_negocio_por_lead_no_funil.sql.
-- Drops the unique index and restores mover_negocio / bulk_move_pipeline_entries
-- to prod as of 13/10 (moving a deal-less card plants a duplicate again).
-- The cleanup is NOT undone: merged cards stay merged. Each deleted row is in
-- backup.cards_sem_negocio_fundidos_20271119 (`card` jsonb) if one must return;
-- its dependents now point at `mantido_id`.
BEGIN;

DROP INDEX IF EXISTS public.uq_pipeline_entries_um_card_sem_negocio;

CREATE OR REPLACE FUNCTION public.mover_negocio(p_entry_id uuid, p_target_pipeline_id uuid, p_target_stage_key text, p_stage_origem text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_lead       uuid;
  v_pipe_atual uuid;
  v_stage_atual text;
  v_tipo_alvo  text;
  v_org_alvo   uuid;
  v_stage_key  text;
BEGIN
  SELECT pe.organization_id, pe.lead_id, pe.pipeline_id, pe.stage_key
    INTO v_org, v_lead, v_pipe_atual, v_stage_atual
    FROM public.pipeline_entries pe
   WHERE pe.id = p_entry_id FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Negócio % não encontrado.', p_entry_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.type, p.organization_id INTO v_tipo_alvo, v_org_alvo
    FROM public.pipelines p WHERE p.id = p_target_pipeline_id;

  IF v_tipo_alvo IS NULL THEN
    RAISE EXCEPTION 'Funil de destino % não existe.', p_target_pipeline_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_org_alvo <> v_org THEN
    RAISE EXCEPTION 'Funil de destino pertence a outra organização.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_target_stage_key IS NULL OR btrim(p_target_stage_key) = '' THEN
    RAISE EXCEPTION 'Etapa de destino é obrigatória.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_stage_key := btrim(p_target_stage_key);

  IF v_stage_key ~ v_uuid_re THEN
    SELECT ps.stage_key INTO v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.id = v_stage_key::uuid AND ps.pipeline_id = p_target_pipeline_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                    WHERE ps.pipeline_id = p_target_pipeline_id
                      AND ps.stage_key = v_stage_key) THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  IF v_pipe_atual = p_target_pipeline_id AND v_stage_atual = v_stage_key THEN
    IF p_assigned_to IS NOT NULL THEN
      UPDATE public.pipeline_entries SET assigned_to = p_assigned_to
       WHERE id = p_entry_id AND assigned_to IS DISTINCT FROM p_assigned_to;
    END IF;
    RETURN p_entry_id;
  END IF;
  IF NULLIF(btrim(p_stage_origem), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages WHERE pipeline_id = v_pipe_atual
      AND stage_key = p_stage_origem AND organization_id = v_org
  ) THEN RAISE EXCEPTION 'Etapa de origem inválida.' USING ERRCODE = '22023'; END IF;

  IF p_stage_origem IS NOT NULL
     AND btrim(p_stage_origem) <> ''
     AND p_stage_origem IS DISTINCT FROM v_stage_atual THEN
    UPDATE public.pipeline_entries
       SET stage_key = p_stage_origem
     WHERE id = p_entry_id;
  END IF;

  UPDATE public.pipeline_entries
     SET pipeline_id = p_target_pipeline_id,
         stage_key   = v_stage_key,
         assigned_to = COALESCE(p_assigned_to, assigned_to)
   WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_move_pipeline_entries(p_entry_ids uuid[], p_source_pipeline_id uuid, p_target_pipeline_id uuid, p_target_stage_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_pipeline uuid;
  v_stage text;
  v_target_key text;
  v_count integer := 0;
BEGIN
  IF p_entry_ids IS NULL OR cardinality(p_entry_ids) = 0 OR cardinality(p_entry_ids) > 1000
    OR array_position(p_entry_ids, NULL) IS NOT NULL OR p_source_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Selecione de 1 a 1000 negócios de origem.' USING ERRCODE = '22023';
  END IF;
  SELECT s.stage_key INTO v_target_key FROM public.pipeline_stages s
    JOIN public.pipelines p ON p.id = s.pipeline_id
    WHERE s.id = p_target_stage_id AND p.id = p_target_pipeline_id AND p.is_active AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funil ou etapa de destino indisponível.' USING ERRCODE = '22023';
  END IF;
  FOR v_id IN SELECT DISTINCT x FROM unnest(p_entry_ids) AS ids(x) ORDER BY x LOOP
    SELECT pipeline_id, stage_key INTO v_pipeline, v_stage
      FROM public.pipeline_entries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Negócio não encontrado ou sem acesso.' USING ERRCODE = '42501';
    END IF;
    IF v_pipeline = p_target_pipeline_id AND v_stage = v_target_key THEN
      v_count := v_count + 1;
      CONTINUE;
    END IF;
    IF v_pipeline IS DISTINCT FROM p_source_pipeline_id THEN
      RAISE EXCEPTION 'O negócio mudou de funil. Atualize a seleção.' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.mover_negocio(v_id, p_target_pipeline_id, p_target_stage_id::text);
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries
      WHERE id = v_id AND pipeline_id = p_target_pipeline_id AND stage_key = v_target_key) THEN
      RAISE EXCEPTION 'Movimentação não autorizada.' USING ERRCODE = '42501';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

DROP FUNCTION IF EXISTS public._repontar_dependentes_do_card(uuid, uuid);

COMMIT;
