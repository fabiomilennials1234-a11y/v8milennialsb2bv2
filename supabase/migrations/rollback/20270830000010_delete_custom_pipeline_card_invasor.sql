-- ROLLBACK de 20270830000010_delete_custom_pipeline_card_invasor.sql
--
-- Volta as duas funções ao corpo de 20270830000000 (sem a recusa de card
-- invasor e sem `cards_invasores` no preview).
--
-- ⚠️ NÃO FAÇA ISSO sem um motivo forte. Sem a recusa, excluir um funil que
-- tenha card de outro funil pousado numa etapa dele volta a estourar `23503`
-- cru na cara do usuário — foi o que aconteceu em prod em 25/08.
-- Se o objetivo é derrubar a feature inteira, rode o rollback da
-- 20270830000000 (que dropa as duas funções) em vez deste.

BEGIN;

CREATE OR REPLACE FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.custom_pipelines WHERE id = p_pipeline_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'cards',          (SELECT count(*)                FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id),
    'leads',          (SELECT count(DISTINCT lead_id) FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id),
    'etapas',         (SELECT count(*)                FROM public.custom_pipeline_stages WHERE pipeline_id = p_pipeline_id),
    'membros',        (SELECT count(*)                FROM public.custom_pipeline_members WHERE pipeline_id = p_pipeline_id),
    'eventos_etapa',  (SELECT count(*)                FROM public.pipeline_stage_events  WHERE pipeline_id = p_pipeline_id),
    'vendas_orfas',   (SELECT count(*)                FROM public.sale_events            WHERE pipeline_id = p_pipeline_id),
    'negocios_orfaos',(SELECT count(DISTINCT deal_id) FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id AND deal_id IS NOT NULL),
    'automacoes',     (SELECT count(*) FROM public.workflows w
                        WHERE w.organization_id = v_org AND w.is_active
                          AND (strpos(w.definition::text, p_pipeline_id::text) > 0
                            OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0)),
    'disparos_em_voo',(SELECT count(*) FROM public.blast_plans b
                        WHERE b.organization_id = v_org AND b.status IN ('active','paused')
                          AND b.post_send_target->>'pipelineId' = p_pipeline_id::text)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org    uuid;
  v_impact jsonb;
  v_wf     integer := 0;
  v_bp     integer := 0;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.custom_pipelines WHERE id = p_pipeline_id FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  v_impact := public.custom_pipeline_delete_impact(p_pipeline_id);

  UPDATE public.workflows w
     SET is_active = false, updated_at = now()
   WHERE w.organization_id = v_org AND w.is_active
     AND (strpos(w.definition::text, p_pipeline_id::text) > 0
       OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  UPDATE public.blast_plans
     SET post_send_target = NULL, updated_at = now()
   WHERE organization_id = v_org AND status IN ('active','paused')
     AND post_send_target->>'pipelineId' = p_pipeline_id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  DELETE FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id;
  DELETE FROM public.custom_pipeline_stages WHERE pipeline_id = p_pipeline_id;

  DELETE FROM public.custom_pipelines WHERE id = p_pipeline_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp
  );
END;
$$;

DO $do$
BEGIN
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'delete_custom_pipeline')
      ILIKE '%card de outro funil%' THEN
    RAISE EXCEPTION 'FAIL: a recusa continua no corpo — o CREATE OR REPLACE não pegou.';
  END IF;
  RAISE NOTICE 'ROLLBACK OK: funções voltaram ao corpo da 20270830000000.';
END
$do$;

COMMIT;
