-- GitHub #2005 / SCRUM-678
--
-- Prévia e confirmação passam a compartilhar a mesma definição de impacto.
-- A confirmação é uma única transação: valida, move cards, desativa workflows
-- que citam a etapa e só então desativa a própria etapa.

CREATE OR REPLACE FUNCTION public.pipeline_stage_delete_impact(p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage public.pipeline_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_stage
  FROM public.pipeline_stages
  WHERE id = p_stage_id;

  IF v_stage.id IS NULL OR v_stage.pipeline_id IS NULL THEN
    RAISE EXCEPTION 'etapa não encontrada em um funil' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_stage.organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user()
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'sem permissão sobre esta etapa' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'stage_id', v_stage.id,
    'pipeline_id', v_stage.pipeline_id,
    'cards', (
      SELECT count(*)
      FROM public.pipeline_entries e
      WHERE e.organization_id = v_stage.organization_id
        AND e.pipeline_id = v_stage.pipeline_id
        AND (
          e.stage_id = v_stage.id
          OR (e.stage_id IS NULL AND e.stage_key = v_stage.stage_key)
        )
    ),
    'automacoes', (
      SELECT count(*)
      FROM public.workflows w
      WHERE w.organization_id = v_stage.organization_id
        AND w.is_active
        AND strpos(w.trigger_config::text, v_stage.id::text) > 0
    ),
    'regras_disparo', (
      SELECT count(*)
      FROM public.pipe_dispatch_rules r
      WHERE r.organization_id = v_stage.organization_id
        AND r.pipeline_stage_id = v_stage.id
        AND r.is_active
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_pipeline_stage(
  p_stage_id uuid,
  p_destination_stage_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage public.pipeline_stages%ROWTYPE;
  v_destination public.pipeline_stages%ROWTYPE;
  v_impact jsonb;
  v_cards integer := 0;
  v_rules integer := 0;
  v_workflows integer := 0;
  v_migrated integer := 0;
BEGIN
  SELECT * INTO v_stage
  FROM public.pipeline_stages
  WHERE id = p_stage_id
  FOR UPDATE;

  IF v_stage.id IS NULL OR v_stage.pipeline_id IS NULL OR NOT v_stage.is_active THEN
    RAISE EXCEPTION 'etapa ativa não encontrada em um funil' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_stage.organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user()
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'sem permissão sobre esta etapa' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_rules
  FROM public.pipe_dispatch_rules r
  WHERE r.organization_id = v_stage.organization_id
    AND r.pipeline_stage_id = v_stage.id
    AND r.is_active;

  IF v_rules > 0 THEN
    RAISE EXCEPTION
      'etapa é alvo de % regra(s) de disparo automático ativa(s)', v_rules
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_cards
  FROM public.pipeline_entries e
  WHERE e.organization_id = v_stage.organization_id
    AND e.pipeline_id = v_stage.pipeline_id
    AND (
      e.stage_id = v_stage.id
      OR (e.stage_id IS NULL AND e.stage_key = v_stage.stage_key)
    );

  IF p_destination_stage_id IS NOT NULL THEN
    SELECT * INTO v_destination
    FROM public.pipeline_stages
    WHERE id = p_destination_stage_id
    FOR UPDATE;

    IF v_destination.id IS NULL
       OR NOT v_destination.is_active
       OR v_destination.id = v_stage.id
       OR v_destination.organization_id != v_stage.organization_id
       OR v_destination.pipeline_id IS DISTINCT FROM v_stage.pipeline_id
    THEN
      RAISE EXCEPTION 'etapa de destino inválida para este funil' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_cards > 0 THEN
    RAISE EXCEPTION
      'etapa tem % card(s); escolha uma etapa de destino', v_cards
      USING ERRCODE = 'P0001';
  END IF;

  v_impact := public.pipeline_stage_delete_impact(v_stage.id);

  IF v_cards > 0 THEN
    UPDATE public.pipeline_entries
    SET stage_id = v_destination.id,
        stage_key = v_destination.stage_key,
        updated_at = now()
    WHERE organization_id = v_stage.organization_id
      AND pipeline_id = v_stage.pipeline_id
      AND (
        stage_id = v_stage.id
        OR (stage_id IS NULL AND stage_key = v_stage.stage_key)
      );
    GET DIAGNOSTICS v_migrated = ROW_COUNT;
  END IF;

  UPDATE public.workflows w
  SET is_active = false,
      updated_at = now()
  WHERE w.organization_id = v_stage.organization_id
    AND w.is_active
    AND strpos(w.trigger_config::text, v_stage.id::text) > 0;
  GET DIAGNOSTICS v_workflows = ROW_COUNT;

  UPDATE public.pipeline_stages
  SET is_active = false,
      updated_at = now()
  WHERE id = v_stage.id
    AND organization_id = v_stage.organization_id
    AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'etapa não foi desativada' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'cards_migrados', v_migrated,
    'automacoes_desativadas', v_workflows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pipeline_stage_delete_impact(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_pipeline_stage(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pipeline_stage_delete_impact(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_pipeline_stage(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pipeline_stage_delete_impact(uuid) IS
  'Prévia autorizada de cards, automações e regras afetados pela remoção de etapa.';
COMMENT ON FUNCTION public.delete_pipeline_stage(uuid, uuid) IS
  'Move cards, desativa workflows afetados e desativa a etapa atomicamente.';
