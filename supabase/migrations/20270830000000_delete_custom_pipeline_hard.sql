-- 20270830000000_delete_custom_pipeline_hard.sql
--
-- Excluir funil customizado passa a ser HARD DELETE.
--
-- ANTES: `useDeleteCustomPipeline` fazia `UPDATE custom_pipelines SET is_active
-- = false`. A linha continuava no banco, `custom_pipe_entries` ficava intacta e
-- a linha-espelho em `pipelines` continuava lá (só com `is_active=false`). Isso
-- vazava em pontos que NÃO filtram `is_active` — a coluna "Situação" da lista de
-- Leads, o painel do Lead, o público "Todos os funis" do Disparo.
--
-- AGORA: a linha some de verdade, com os filhos, numa transação só.
--
-- POR QUE RPC e não `.delete()` direto do cliente:
--   1. Transação. O cliente supabase-js não abre transação: 4 statements soltos
--      podem parar no meio e deixar o funil sem etapas.
--   2. `blast_plans` e `workflows` precisam de UPDATE que a policy do membro
--      comum não necessariamente cobre — SECURITY DEFINER resolve com a
--      autorização reimplementada no corpo.
--   3. `.delete()` sem `.select()` NÃO distingue "apagou" de "a RLS não casou
--      com nenhuma linha" — as duas devolvem sucesso silencioso.
--
-- ORDEM DO DELETE — deliberadamente EXPLÍCITA, filhos antes do pai:
--   `custom_pipe_entries.stage_id -> custom_pipeline_stages(id)` é a única FK
--   da árvore SEM cláusula `ON DELETE` (NO ACTION). Num `DELETE` só do pai ela
--   provavelmente passaria (NO ACTION é checado no fim do statement e as duas
--   filhas caem no mesmo statement), mas "provavelmente" não é medição. Apagar
--   entries -> stages -> pipeline torna a pergunta irrelevante.
--
-- O QUE O BANCO FAZ SOZINHO depois do delete do pai:
--   `trg_sync_custom_pipeline` apaga a linha-espelho em `pipelines`, e daí
--   caem por CASCADE `pipeline_entries` e `pipeline_stage_events`.
--
-- 🚨 O QUE SE PERDE, E É IRREVERSÍVEL:
--   `pipeline_stage_events` daquele funil (o caderno append-only que o ADR-0017
--   declara "fonte ÚNICA de métricas de funil"). Conversão entre etapas e tempo
--   médio de etapa daquele funil zeram. O guard de imutabilidade NÃO barra —
--   `fn_pipeline_stage_events_block_mutation` só levanta quando a linha de
--   `pipelines` ainda existe, e nesse ponto ela já foi apagada.
--
-- O QUE SOBREVIVE:
--   `leads` (a seta da FK é lead -> entry, nunca o contrário), `lead_history`
--   (grava nome do funil/etapa como TEXTO), `sale_events` (sem FK para
--   `pipelines` — sobrevive ÓRFÃ, ver aviso abaixo) e `deals` (o vínculo é
--   `custom_pipe_entries.deal_id -> deals ON DELETE SET NULL`, seta ao
--   contrário — por decisão de produto os Negócios NÃO são apagados).
--
-- ⚠️ ÓRFÃO CONHECIDO E NÃO TRATADO: `sale_events.pipeline_id` não tem FK e a
--   tabela é imutável por trigger (`trg_sale_events_immutable`) — não dá para
--   re-etiquetar. A receita do funil apagado continua contabilizada no total da
--   org e nos recortes por closer/tag/produto, mas no recorte POR FUNIL passa a
--   aparecer como "Sem valor". Isso é consequência aceita, não descuido.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Prévia de impacto (read-only) — alimenta o diálogo de confirmação.
-- ────────────────────────────────────────────────────────────────────────────
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

  -- SECURITY DEFINER bypassa RLS: a autorização é reimplementada aqui.
  -- `current_setting('role')` é a convenção do repo para reconhecer a chave de
  -- serviço. Numa conexão direta (Management API) ela vale 'none', não
  -- 'service_role' — então SQL administrativo NÃO passa por aqui de graça.
  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    -- cards <> leads: a UNIQUE (pipeline_id, lead_id) foi dropada, então o
    -- mesmo lead pode ter N cards no mesmo funil. O aviso ao usuário usa leads.
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
    -- ADR-0017: some por CASCADE e não tem backup lógico.
    'eventos_etapa',
      (SELECT count(*) FROM public.pipeline_stage_events
        WHERE pipeline_id = p_pipeline_id),
    -- Sem FK para pipelines: sobrevive com ponteiro morto.
    'vendas_orfas',
      (SELECT count(*) FROM public.sale_events
        WHERE pipeline_id = p_pipeline_id),
    -- Sobrevivem, mas a UI só os alcança pelo card.
    'negocios_orfaos',
      (SELECT count(DISTINCT deal_id) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id AND deal_id IS NOT NULL),
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

COMMENT ON FUNCTION public.custom_pipeline_delete_impact(uuid) IS
  'Prévia do que delete_custom_pipeline vai destruir. Read-only. Autorização por org do chamador ou master.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O hard delete.
-- ────────────────────────────────────────────────────────────────────────────
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
    FROM public.custom_pipelines
   WHERE id = p_pipeline_id
     FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- `current_setting('role')` é a convenção do repo para reconhecer a chave de
  -- serviço. Numa conexão direta (Management API) ela vale 'none', não
  -- 'service_role' — então SQL administrativo NÃO passa por aqui de graça.
  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  -- Medir ANTES de apagar — depois os números seriam todos zero.
  v_impact := public.custom_pipeline_delete_impact(p_pipeline_id);

  -- (a) Automações que citam o funil param de disparar EM SILÊNCIO (o motor só
  --     compara o uuid e devolve `false`). Desativar é honesto: aparece
  --     desligada na tela, em vez de "ligada e morta". NÃO reescrevemos o JSON
  --     — mexer no grafo às cegas corrompe a automação.
  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = v_org
     AND w.is_active
     AND (strpos(w.definition::text, p_pipeline_id::text) > 0
       OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- (b) Disparo em voo com destino neste funil: o release diário NÃO revalida
  --     o destino (a validação é fail-closed só na criação), então entregaria
  --     a mensagem e não moveria ninguém. NULL = "mantém o lead onde está".
  UPDATE public.blast_plans
     SET post_send_target = NULL,
         updated_at = now()
   WHERE organization_id = v_org
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = p_pipeline_id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  -- (c) Filhos antes do pai — ver nota de ORDEM no cabeçalho.
  DELETE FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id;
  DELETE FROM public.custom_pipeline_stages WHERE pipeline_id = p_pipeline_id;

  -- (d) O pai. `trg_sync_custom_pipeline` limpa o espelho em `pipelines`,
  --     levando `pipeline_entries` e `pipeline_stage_events` por CASCADE.
  --     `custom_pipeline_members` e `custom_pipe_transitions` caem aqui.
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
  'HARD DELETE de funil customizado, transacional. Apaga entries/etapas/membros/transições, o espelho em pipelines e — por CASCADE — pipeline_stage_events (IRREVERSÍVEL, ADR-0017). Leads sobrevivem. Desativa automações e neutraliza disparos em voo que apontavam para o funil.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Grants — nunca anon.
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.custom_pipeline_delete_impact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_custom_pipeline(uuid)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.custom_pipeline_delete_impact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_custom_pipeline(uuid)        TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Verificação — falha alto no próprio apply.
-- ────────────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_n    integer;
  v_anon boolean;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('delete_custom_pipeline', 'custom_pipeline_delete_impact');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: esperava 2 funções, achei % (overload duplicado dá 42725 na chamada).', v_n;
  END IF;

  SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) INTO v_anon
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('delete_custom_pipeline', 'custom_pipeline_delete_impact');
  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon ficou com EXECUTE.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: delete_custom_pipeline + custom_pipeline_delete_impact criadas, anon sem EXECUTE.';
END
$do$;

COMMIT;
