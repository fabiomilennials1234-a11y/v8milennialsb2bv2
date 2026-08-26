-- 20270831000010_delete_system_pipeline_hard.sql
--
-- Excluir funil de SISTEMA (Oportunidades, Agendamentos, Orçamentos, Carteira)
-- passa a existir. Antes não havia botão em lugar nenhum: `delete_custom_pipeline`
-- só alcança `custom_pipelines`, e funil de sistema não tem linha lá (medido em
-- prod: as 3 linhas de `pipelines` type='system' da Milennials têm ZERO par em
-- `custom_pipelines`). Não era permissão nem feature flag — era ausência.
--
-- Depende de 20270831000000, que fechou as torneiras de auto-semeadura. SEM
-- ELA esta RPC é inútil: apagar tudo e recarregar a página recriava o funil.
--
-- ── O MODELO, QUE NÃO É O DO FUNIL CUSTOM ───────────────────────────────────
--
-- Funil de sistema não é uma linha em `pipelines` com filhos pendurados nela. É
-- um conjunto de tabelas chaveadas por (organization_id, pipe_type):
--
--   pipe_whatsapp / pipe_confirmacao / pipe_propostas  ← os CARDS (col `status`
--       é a etapa; não há pipeline_id). `pipeline_entries` é ESPELHO delas,
--       mantido por `trg_pipe_*_delete` (que apaga a entry de mesmo id).
--   pipeline_stages         (organization_id, pipeline_type, stage_key)
--   pipe_dispatch_rules / pipe_distribution_rules / sla_configs /
--   scheduled_pipe_messages (organization_id, pipe_type)
--   pipelines               ← a linha de REGISTRO, slug = pipe_type
--   pipeline_display_config ← o registro de "a org tem este funil"
--
-- Por isso o delete não é "apaga o pai e deixa o CASCADE trabalhar": só
-- `pipeline_entries` e `pipeline_stage_events` são filhas de `pipelines`.
--
-- ── 🚨 O GATILHO QUE NÃO DISPARA — o achado que só apareceu EXECUTANDO ──────
--
-- `leads.pipe_whatsapp` é uma coluna-espelho: guarda a etapa do lead no funil
-- de sistema WhatsApp. Existe um gatilho para mantê-la
-- (`trg_sync_whatsapp_stage_to_lead`, DELETE em `pipeline_entries`), e ler o
-- código dá a impressão de que apagar os cards a limpa sozinha. **Não limpa.**
-- A primeira linha da função é:
--
--     IF pg_trigger_depth() > 1 THEN ... RETURN; END IF;
--
-- uma trava contra reentrância, posta por causa do sync com
-- `custom_pipe_entries`. Só que apagar `pipe_whatsapp` dispara
-- `pipe_whatsapp_delete_fn`, que é quem apaga `pipeline_entries` — ou seja, o
-- sync já nasce em profundidade 2. A trava bate SEMPRE neste caminho e a
-- função retorna sem fazer nada.
--
-- Medido no ensaio contra prod: a primeira versão desta RPC deixou **1.248
-- leads** da Milennials com `pipe_whatsapp` apontando para a etapa de um funil
-- que já não existia. A asserção do ensaio pegou.
--
-- 🔑 A lição não é "a ordem estava errada" — reordenar não conserta isto. É que
--    **gatilho lido não é gatilho executado**: a guarda de profundidade torna
--    inerte, neste caminho, um código que parece cobrir o caso. Por isso a RPC
--    zera a coluna À MÃO, no passo (e), em vez de depender do gatilho.
--
-- ── ORDEM ───────────────────────────────────────────────────────────────────
-- Espelho no lead → cards → etapas → `pipelines` → registro. Explícita porque
-- só `pipeline_entries` e `pipeline_stage_events` penduram em `pipelines`; o
-- resto é chaveado por (org, pipe_type) e ninguém apaga por nós.
--
-- ── O QUE OS GATILHOS FAZEM SOZINHOS (verificado EXECUTANDO, não lendo) ──────
--
--   `pipe_*_delete_fn`            → apaga a `pipeline_entries` de mesmo id. ✅
--   `trg_sync_whatsapp_stage_to_lead` → 🚨 **NÃO RODA AQUI** (trava de
--       profundidade, acima). O passo (e) faz o trabalho dele.
--   `on_pipeline_stage_removed`   → limpa `copilot_agents.active_stages`,
--       `move_rules` e `copilot_agent_kanban_rules` que citavam a etapa. ✅
--   `trg_queue_followup_reclassify` → enfileira reclassificação de follow-up. ✅
--
-- ✅ NENHUM deles manda mensagem. O disparo de WhatsApp mora em
--    `stage_changed`, que é gatilho de UPDATE — e aqui não há UPDATE de etapa.
--    Foi o motivo de o delete de funil custom RECUSAR repontuar card invasor.
--
-- ⚠️ `copilot_agents.active_pipes` NÃO é limpo por gatilho nenhum (o de etapa
--    só mexe em `active_stages`). A RPC limpa explicitamente — senão sobra
--    agente de IA configurado para um funil inexistente.
--
-- 🚨 O QUE SE PERDE, E É IRREVERSÍVEL:
--   `pipeline_stage_events` do funil, por CASCADE — o caderno append-only que o
--   ADR-0017 chama de fonte ÚNICA de métricas de funil. Sem backup lógico. O
--   guard de imutabilidade não barra: `fn_pipeline_stage_events_block_mutation`
--   só levanta enquanto a linha de `pipelines` existe, e nesse ponto ela já caiu.
--
-- ⚠️ ÓRFÃO ACEITO: `sale_events.pipeline_id` não tem FK e a tabela é imutável
--   por gatilho. A receita continua certa no total da org e nos recortes por
--   closer/tag/produto; no recorte POR FUNIL passa a aparecer como "Sem valor".
--   Mesma consequência já aceita em `delete_custom_pipeline` (20270830000000).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Prévia de impacto (read-only) — alimenta o diálogo de confirmação.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.system_pipeline_delete_impact(
  p_org_id    uuid,
  p_pipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id uuid;
  v_cards       bigint := 0;
  v_leads       bigint := 0;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  -- SECURITY DEFINER bypassa RLS: a autorização é reimplementada aqui.
  -- `current_setting('role')` é a convenção do repo para a chave de serviço;
  -- numa conexão direta (Management API) ela vale 'none', não 'service_role'.
  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type AND type = 'system'; -- metric-lint-allow: não é métrica — é a resolução da linha de REGISTRO do funil de sistema que está sendo excluído. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir, a partir do par (org, pipe_type) que o usuário escolheu na tela.

  -- Contagem de cards: cada tipo tem a sua própria tabela, sem coluna comum
  -- para parametrizar. Três ramos explícitos em vez de EXECUTE com nome de
  -- tabela interpolado — mais longo, e sem superfície de injeção.
  IF p_pipe_type = 'whatsapp' THEN
    SELECT count(*), count(DISTINCT lead_id) INTO v_cards, v_leads
      FROM public.pipe_whatsapp WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'confirmacao' THEN
    SELECT count(*), count(DISTINCT lead_id) INTO v_cards, v_leads
      FROM public.pipe_confirmacao WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'propostas' THEN
    SELECT count(*), count(DISTINCT lead_id) INTO v_cards, v_leads
      FROM public.pipe_propostas WHERE organization_id = p_org_id;
  END IF;
  -- `upsell` não tem tabela de cards: a Carteira é faceta do lead, não funil.

  RETURN jsonb_build_object(
    'pipe_type',   p_pipe_type,
    'pipeline_id', v_pipeline_id,
    'cards',       v_cards,
    'leads',       v_leads,
    'etapas',
      (SELECT count(*) FROM public.pipeline_stages
        WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type),
    -- ADR-0017: some por CASCADE e não tem backup lógico.
    'eventos_etapa',
      (SELECT count(*) FROM public.pipeline_stage_events
        WHERE pipeline_id = v_pipeline_id),
    -- Sem FK para pipelines: sobrevive com ponteiro morto.
    'vendas_orfas',
      (SELECT count(*) FROM public.sale_events
        WHERE pipeline_id = v_pipeline_id),
    -- 🚨 Casa os DOIS jeitos de citar o funil. Medido em prod: das 30 automações
    -- com `filter_pipe`, 14 NÃO têm `filter_pipeline_id` — casar só pelo uuid
    -- deixaria quase metade delas viva e apontando para o vazio. E o slug vem
    -- COM prefixo (`pipe_whatsapp`) no gatilho `lead_created` e SEM prefixo no
    -- `stage_changed`/`scheduled_date`; por isso as duas formas entram.
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = p_org_id
          AND w.is_active
          AND (w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type)
            OR (v_pipeline_id IS NOT NULL
                AND (strpos(w.definition::text, v_pipeline_id::text) > 0
                  OR strpos(w.trigger_config::text, v_pipeline_id::text) > 0)))),
    'regras_dispatch',
      (SELECT count(*) FROM public.pipe_dispatch_rules
        WHERE organization_id = p_org_id AND pipe_type = p_pipe_type),
    'regras_distribuicao',
      (SELECT count(*) FROM public.pipe_distribution_rules
        WHERE organization_id = p_org_id AND pipe_type = p_pipe_type),
    'mensagens_agendadas',
      (SELECT count(*) FROM public.scheduled_pipe_messages
        WHERE organization_id = p_org_id
          AND pipe_type = p_pipe_type
          AND status IN ('pending', 'waiting')),
    -- Agentes de IA que operam este funil. O gatilho de etapa limpa
    -- active_stages/move_rules; `active_pipes` é limpo pela RPC.
    'agentes_copilot',
      (SELECT count(*) FROM public.copilot_agents
        WHERE organization_id = p_org_id AND active_pipes ? p_pipe_type)
  );
END;
$$;

COMMENT ON FUNCTION public.system_pipeline_delete_impact(uuid, text) IS
  'Prévia do que delete_system_pipeline vai destruir. Read-only. Autorização por org do chamador ou master.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O hard delete.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_system_pipeline(
  p_org_id    uuid,
  p_pipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id uuid;
  v_impact      jsonb;
  v_wf          integer := 0;
  v_bp          integer := 0;
  v_cop         integer := 0;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  -- O registro é a fonte da verdade sobre "a org tem este funil". Sem linha,
  -- não há o que excluir — e recusar é melhor que devolver sucesso vazio.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_display_config
     WHERE organization_id = p_org_id AND pipe_type = p_pipe_type
  ) THEN
    RAISE EXCEPTION 'esta organização não tem o funil %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type AND type = 'system' -- metric-lint-allow: não é métrica — é a resolução da linha de REGISTRO do funil de sistema que está sendo excluído, travada com FOR UPDATE. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir, a partir do par (org, pipe_type) escolhido na tela.
     FOR UPDATE;

  -- Medir ANTES de apagar — depois os números seriam todos zero.
  v_impact := public.system_pipeline_delete_impact(p_org_id, p_pipe_type);

  -- (a) Automações que citam o funil param de disparar EM SILÊNCIO (o motor só
  --     compara e devolve `false`). Desativar é honesto: aparece desligada na
  --     tela, em vez de "ligada e morta". NÃO reescrevemos o JSON — mexer no
  --     grafo às cegas corrompe a automação.
  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = p_org_id
     AND w.is_active
     AND (w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type)
       OR (v_pipeline_id IS NOT NULL
           AND (strpos(w.definition::text, v_pipeline_id::text) > 0
             OR strpos(w.trigger_config::text, v_pipeline_id::text) > 0)));
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- (b) Disparo em voo com destino neste funil: o release diário NÃO revalida
  --     o destino, então entregaria a mensagem e não moveria ninguém.
  --     NULL = "mantém o lead onde está".
  IF v_pipeline_id IS NOT NULL THEN
    UPDATE public.blast_plans
       SET post_send_target = NULL,
           updated_at = now()
     WHERE organization_id = p_org_id
       AND status IN ('active', 'paused')
       AND post_send_target->>'pipelineId' = v_pipeline_id::text;
    GET DIAGNOSTICS v_bp = ROW_COUNT;
  END IF;

  -- (c) Agente de IA que operava o funil. Nenhum gatilho limpa `active_pipes`
  --     (o de etapa só mexe em `active_stages`/`move_rules`), então sem isto
  --     sobraria Copilot configurado para um funil inexistente.
  UPDATE public.copilot_agents
     SET active_pipes  = active_pipes - p_pipe_type,
         active_stages = COALESCE(active_stages, '{}'::jsonb) - p_pipe_type,
         updated_at    = now()
   WHERE organization_id = p_org_id
     AND active_pipes ? p_pipe_type;
  GET DIAGNOSTICS v_cop = ROW_COUNT;

  -- (d) Regras e mensagens em voo, chaveadas por (org, pipe_type).
  --     Passos antes das regras: a FK filha não declara ON DELETE.
  DELETE FROM public.pipe_dispatch_rule_steps
   WHERE rule_id IN (SELECT id FROM public.pipe_dispatch_rules
                      WHERE organization_id = p_org_id AND pipe_type = p_pipe_type);
  DELETE FROM public.pipe_dispatch_rules
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.pipe_distribution_rules
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.scheduled_pipe_messages
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.sla_configs
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  -- (e) 🚨 O ESPELHO NO LEAD, À MÃO — e ANTES dos cards.
  --
  --     `leads.pipe_whatsapp` guarda a etapa do lead no funil de sistema
  --     WhatsApp. Existe um gatilho para mantê-lo
  --     (`trg_sync_whatsapp_stage_to_lead`, DELETE em `pipeline_entries`), e
  --     ele NÃO roda neste caminho. A primeira linha da função é:
  --
  --         IF pg_trigger_depth() > 1 THEN ... RETURN; END IF;
  --
  --     uma trava contra reentrância, posta por causa do sync com
  --     `custom_pipe_entries`. Só que apagar `pipe_whatsapp` dispara
  --     `pipe_whatsapp_delete_fn`, que apaga `pipeline_entries` — já em
  --     profundidade 2. A trava bate, a função retorna e o espelho nunca é
  --     limpo.
  --
  --     Medido no ensaio contra prod: sem esta linha, a exclusão do funil da
  --     Milennials deixava **1.248 leads** com `pipe_whatsapp` apontando para a
  --     etapa de um funil inexistente. A asserção do ensaio pegou; reordenar os
  --     deletes NÃO resolvia, porque o problema nunca foi a ordem — era a trava
  --     de profundidade. Depender do gatilho aqui seria depender de código que
  --     comprovadamente não executa.
  IF p_pipe_type = 'whatsapp' THEN
    UPDATE public.leads
       SET pipe_whatsapp = NULL
     WHERE organization_id = p_org_id
       AND pipe_whatsapp IS NOT NULL;
  END IF;

  -- (f) Os cards.
  IF p_pipe_type = 'propostas' THEN
    -- `pipe_proposta_items.pipe_proposta_id` NÃO tem FK: ninguém apaga por nós.
    DELETE FROM public.pipe_proposta_items
     WHERE pipe_proposta_id IN (SELECT id FROM public.pipe_propostas
                                 WHERE organization_id = p_org_id);
    DELETE FROM public.pipe_propostas   WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'confirmacao' THEN
    DELETE FROM public.pipe_confirmacao WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'whatsapp' THEN
    DELETE FROM public.pipe_whatsapp    WHERE organization_id = p_org_id;
  END IF;

  -- (g) As etapas. Dispara `on_pipeline_stage_removed`, que limpa as regras de
  --     kanban do Copilot, e `trg_queue_followup_reclassify`.
  DELETE FROM public.pipeline_stages
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  -- (h) A linha de registro em `pipelines`. Leva por CASCADE o que sobrou de
  --     `pipeline_entries` (entry sem card, se houver) e `pipeline_stage_events`.
  IF v_pipeline_id IS NOT NULL THEN
    DELETE FROM public.pipelines WHERE id = v_pipeline_id;
  END IF;

  -- (i) O registro. É ESTE delete que impede o funil de voltar: sem a linha,
  --     `create_default_pipelines` não recria o espelho e o front não semeia
  --     etapa (20270831000000).
  DELETE FROM public.pipeline_display_config
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE do registro não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp,
    'agentes_ajustados',      v_cop
  );
END;
$$;

COMMENT ON FUNCTION public.delete_system_pipeline(uuid, text) IS
  'HARD DELETE de funil de sistema numa org, transacional. Ordem obrigatória cards -> etapas -> pipelines -> registro: inverter congela leads.pipe_whatsapp apontando para funil inexistente. Apaga pipeline_stage_events por CASCADE (IRREVERSÍVEL, ADR-0017). Leads sobrevivem sem posição. Desativa automações (casa slug COM e SEM prefixo, e o uuid), neutraliza disparos em voo e tira o funil dos agentes de Copilot.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Grants — nunca anon.
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.system_pipeline_delete_impact(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_system_pipeline(uuid, text)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_pipeline_delete_impact(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_system_pipeline(uuid, text)        TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Verificação — falha alto no próprio apply.
-- ────────────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_n    integer;
  v_anon boolean;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('delete_system_pipeline', 'system_pipeline_delete_impact');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FALHA: esperava 2 funções, achei % (overload duplicado dá 42725 na chamada).', v_n;
  END IF;

  SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) INTO v_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('delete_system_pipeline', 'system_pipeline_delete_impact');
  IF v_anon THEN
    RAISE EXCEPTION 'FALHA: anon ficou com EXECUTE.';
  END IF;

  -- A dependência é dura: sem o registro consultado por create_default_pipelines
  -- esta RPC apaga e o funil volta na leitura seguinte.
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'create_default_pipelines')
     !~* 'pipeline_display_config' THEN
    RAISE EXCEPTION 'FALHA: 20270831000000 não está aplicada — o funil voltaria sozinho.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: delete_system_pipeline + impact criadas, anon sem EXECUTE, torneira 2 fechada.';
END
$do$;

COMMIT;
