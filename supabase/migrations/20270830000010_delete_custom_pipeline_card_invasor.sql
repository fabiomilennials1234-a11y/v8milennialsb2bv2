-- 20270830000010_delete_custom_pipeline_card_invasor.sql
--
-- Conserta um buraco em `delete_custom_pipeline` (20270830000000): ela estourava
-- `23503` cru quando um card de OUTRO funil estava parado numa etapa deste.
--
-- COMO ISSO EXISTE: `custom_pipe_entries.stage_id → custom_pipeline_stages(id)`
-- não exige que a etapa pertença ao MESMO funil da entry. Nada no banco impede
-- `entry.pipeline_id = A` com `stage.pipeline_id = B`. Medido em prod 25/08:
-- 3 casos em 16.260 cards — dois deles entre funis ATIVOS.
--
-- O card invasor já está quebrado hoje: o kanban do funil dele não tem essa
-- coluna, então ele não aparece em lugar nenhum. Mas consertar não é atribuição
-- de quem está excluindo OUTRO funil:
--
--   • Repontuar para uma etapa válida dispara `trg_workflow_custom_pipe_stage_change`,
--     que chama `fire_workflow_trigger('stage_changed', ...)` — ou seja, pode
--     MANDAR MENSAGEM DE WHATSAPP para um lead que não tem nada a ver com o
--     funil sendo excluído. E `trg_apply_stage_checklist_custom` criaria
--     checklist junto.
--   • Apagar destrói card de um funil que pode estar ATIVO e em uso.
--
-- Nenhum dos dois pode ser efeito colateral silencioso. Então a função RECUSA,
-- dizendo quantos e qual, e um humano decide. O preview passa a contar o mesmo
-- número, para o aviso chegar ANTES do clique.

BEGIN;

-- ── Preview: passa a expor `cards_invasores` ────────────────────────────────
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
    FROM public.custom_pipelines
   WHERE id = p_pipeline_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'cards',
      (SELECT count(*) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id),
    'leads',
      (SELECT count(DISTINCT lead_id) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id),
    'etapas',
      (SELECT count(*) FROM public.custom_pipeline_stages
        WHERE pipeline_id = p_pipeline_id),
    'membros',
      (SELECT count(*) FROM public.custom_pipeline_members
        WHERE pipeline_id = p_pipeline_id),
    'eventos_etapa',
      (SELECT count(*) FROM public.pipeline_stage_events
        WHERE pipeline_id = p_pipeline_id),
    'vendas_orfas',
      (SELECT count(*) FROM public.sale_events
        WHERE pipeline_id = p_pipeline_id),
    'negocios_orfaos',
      (SELECT count(DISTINCT deal_id) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id AND deal_id IS NOT NULL),
    -- NOVO: card de outro funil pousado numa etapa deste. > 0 impede o delete.
    'cards_invasores',
      (SELECT count(*) FROM public.custom_pipe_entries e
         JOIN public.custom_pipeline_stages s ON s.id = e.stage_id
        WHERE s.pipeline_id = p_pipeline_id
          AND e.pipeline_id <> p_pipeline_id),
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = v_org
          AND w.is_active
          AND (strpos(w.definition::text, p_pipeline_id::text) > 0
            OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0)),
    'disparos_em_voo',
      (SELECT count(*) FROM public.blast_plans b
        WHERE b.organization_id = v_org
          AND b.status IN ('active', 'paused')
          AND b.post_send_target->>'pipelineId' = p_pipeline_id::text)
  );
END;
$$;

-- ── Delete: recusa antes de tocar em qualquer coisa ─────────────────────────
CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org       uuid;
  v_impact    jsonb;
  v_wf        integer := 0;
  v_bp        integer := 0;
  v_invasores integer := 0;
  v_exemplo   text;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.custom_pipelines
   WHERE id = p_pipeline_id
     FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  -- 🚨 A recusa. ANTES de qualquer escrita, para a transação nem começar a
  --    sujar. Ver o cabeçalho: repontuar dispara automação, apagar destrói
  --    card alheio — a decisão é humana.
  SELECT count(*), min(coalesce(p.name, '(sem nome)') || ' / ' || coalesce(l.name, e.lead_id::text))
    INTO v_invasores, v_exemplo
    FROM public.custom_pipe_entries e
    JOIN public.custom_pipeline_stages s ON s.id = e.stage_id
    LEFT JOIN public.custom_pipelines p ON p.id = e.pipeline_id
    LEFT JOIN public.leads l            ON l.id = e.lead_id
   WHERE s.pipeline_id = p_pipeline_id
     AND e.pipeline_id <> p_pipeline_id;

  IF v_invasores > 0 THEN
    RAISE EXCEPTION
      'card de outro funil parado numa etapa deste: % card(s), ex. "%". Mova-os para o funil de origem antes de excluir.',
      v_invasores, v_exemplo
      USING ERRCODE = 'P0001';
  END IF;

  v_impact := public.custom_pipeline_delete_impact(p_pipeline_id);

  -- (a) Automações que citam o funil parariam de disparar em silêncio.
  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = v_org
     AND w.is_active
     AND (strpos(w.definition::text, p_pipeline_id::text) > 0
       OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- (b) Disparo em voo com destino aqui: NULL = mantém o lead onde está.
  UPDATE public.blast_plans
     SET post_send_target = NULL,
         updated_at = now()
   WHERE organization_id = v_org
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = p_pipeline_id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  -- (c) Filhos antes do pai. Com a recusa acima, nenhuma etapa daqui tem card
  --     de fora pendurado, então o NO ACTION de `custom_pipe_entries.stage_id`
  --     não tem como barrar.
  DELETE FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id;
  DELETE FROM public.custom_pipeline_stages WHERE pipeline_id = p_pipeline_id;

  -- (d) O pai. O trigger de sync limpa o espelho em `pipelines`, levando
  --     `pipeline_entries` e `pipeline_stage_events` por CASCADE.
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

COMMENT ON FUNCTION public.delete_custom_pipeline(uuid) IS
  'HARD DELETE de funil customizado, transacional. Recusa (P0001) se algum card de OUTRO funil estiver numa etapa deste — repontuar dispararia automação, apagar destruiria card alheio. Apaga entries/etapas/membros/transições, o espelho em pipelines e — por CASCADE — pipeline_stage_events (IRREVERSÍVEL, ADR-0017). Leads sobrevivem.';

-- ── Verificação ─────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('delete_custom_pipeline', 'custom_pipeline_delete_impact');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: esperava 2 funções, achei % (overload).', v_n;
  END IF;

  IF (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('delete_custom_pipeline', 'custom_pipeline_delete_impact')) THEN
    RAISE EXCEPTION 'FAIL: anon ficou com EXECUTE.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: recusa de card invasor ativa, anon sem EXECUTE.';
END
$do$;

COMMIT;
