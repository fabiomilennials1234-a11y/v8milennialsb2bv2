-- 20270919000020 — SCRUM-647, fatia 2
-- As leitoras das views de compat passam a ler a projecao canonica.
--
-- CONTEXTO
-- A fatia 1 (20270919000000, ja em prod) criou `public.negocio_projetado` e
-- moveu 6 funcoes que traduziam `pipeline_entries.metadata` INLINE. Nenhuma
-- leitora de VIEW foi tocada. Esta fatia move as leitoras de view.
--
-- MEDICAO DE PARTIDA (prod jsjsmuncfkbsbzqzqhfq, 2026-09-03, pg_get_functiondef)
-- 29 funcoes de `public` citam uma das 6 views de compat em FROM/JOIN.
-- Destas, 15 sao migradas aqui, 1 em 20270919000030 e 13 ficam — cada uma com
-- o motivo MEDIDO na secao BARREIRA, abaixo.
--
-- REGRA QUE GOVERNA TUDO: nenhum numero muda.
-- Nao ha "equivalencia obvia" neste arquivo. Cada corpo foi capturado de prod
-- com `pg_get_functiondef` e reescrito por SUBSTITUICAO PROGRAMATICA de um
-- trecho exato — o resto do corpo e byte-a-byte o de prod. A igualdade e
-- provada por org real em `scripts/ensaio-647-fatia2.sh`, que roda a funcao
-- ANTES e DEPOIS na MESMA transacao e ABORTA na primeira divergencia.
--
-- AS TRES TRADUCOES USADAS, e por que cada uma preserva o recorte
--
--   1. `pipe_whatsapp|confirmacao|propostas`  ->  `negocio_projetado`
--      + `funil_sistema = '<slug>'`.
--      A viewdef de prod casa o slug do funil E exige que ele seja nativo.
--      `funil_sistema` e exatamente `CASE type WHEN 'system' THEN slug END`,
--      entao `funil_sistema = '<slug>'` e o MESMO predicado numa coluna so.
--      Efeito colateral bem-vindo: some o `type = 'system'` que a regra R3 do
--      lint proibe — get_all_funnels_lead_ids perde um `metric-lint-allow`.
--
--   2. `custom_pipe_entries`  ->  `negocio_projetado` + `pipeline_type = 'custom'`.
--      A viewdef filtra `p.type = 'custom'`. Medido em prod: `pipelines.type`
--      so tem dois valores, 'system' (318) e 'custom' (83) — nao ha terceiro
--      tipo que a troca pudesse incluir ou excluir por engano.
--
--   3. `custom_pipelines` / `custom_pipeline_stages`  ->  `pipelines` /
--      `pipeline_stages` + `type = 'custom'`.
--      Estas DUAS views nao sao de entrada: nao ha projecao de dinheiro nelas
--      e `negocio_projetado` nao as cobre. Sao `pipelines`/`pipeline_stages`
--      filtradas por funil custom, e e para la que voltam. O predicado
--      `type = 'custom'` so e omitido onde o RAMO QUE O CONTEM ja provou o
--      tipo (comentado caso a caso abaixo) — nunca por conveniencia.
--
-- COLUNA QUE MUDA DE NOME: `status`.
-- As 3 views de dinheiro projetam `pe.stage_key AS status`. A projecao expoe
-- `stage_key`. Onde o corpo lia `pp.status`/`pc.status`, passa a ler
-- `stage_key` — e onde esse nome era contrato de uma CTE, o alias `AS status`
-- foi preservado para que o consumidor da CTE nao mude (get_analytics_engagement_metrics).
--
-- SEM DROP: todas as funcoes sao `CREATE OR REPLACE`, com assinatura, volatilidade
-- e `search_path` identicos aos de prod. DROP+CREATE devolveria EXECUTE para
-- PUBLIC/anon; nenhuma linha deste arquivo faz DROP, entao nao ha grant a
-- redeclarar. O ensaio ainda assim confere `has_function_privilege` das 16
-- antes e depois, porque "nao fiz DROP" e afirmacao, nao medicao.
--
-- RLS NAO MUDA. As 6 views de compat sao `security_invoker = on`; a projecao
-- tambem (medido). Trocar uma view invoker por outra view invoker dentro do
-- mesmo corpo nao move o ponto onde a RLS e avaliada, nem o papel que a avalia.
--
-- ═══ BARREIRA — as 13 que NAO entram, com o motivo medido ═══════════════════
--
-- (a) 8 reprovam `ledger-revenue` do scripts/check-metric-antipatterns.sh ao
--     serem reemitidas: `SUM(sale_value)` num arquivo que nao le `sale_events`.
--     get_analytics_commercial_metrics, get_analytics_financial_metrics,
--     get_analytics_overview_metrics, get_analytics_utm_metrics,
--     get_mkt_origin_metrics, get_ranking_data, get_leads_by_uf, get_uf_heatmap.
--     O ticket proibe `allow` novo, e ler de `sale_events` MUDA o numero (o
--     caderno e liquido de estorno; a metadata nao e). Sao fatia de ADR-0017,
--     decisao do CTO — nao carona de refatoracao.
-- (b) get_analytics_pipeline_metrics: mesma familia, e na lista explicita do
--     CTO. Passaria o lint (o corpo ja cita `sale_events`), e mesmo assim fica.
-- (c) get_next_best_actions: reemitir aciona R4 — o ultimo-toque da proposta
--     comparado contra uma janela de 7 dias E a propria regra de "proposta
--     parada". Trocar essa ancora muda quais propostas aparecem.
-- (d) trigger_google_calendar_sync: reemitir aciona R5 — o corpo encadeia
--     duas chaves de atribuicao para escolher o dono do evento, numa linha que
--     nem faz parte da leitura da view. Corrigi-la muda quem e creditado.
-- (e) bulk_delete_leads e remove_demo_data: NAO leem as views. So escrevem
--     (`DELETE FROM public.pipe_*` / `custom_pipelines`), pelos INSTEAD OF.
--     Migrar escrita e a SCRUM-639, nao esta fatia. Aparecem na varredura
--     porque `DELETE FROM <view>` casa com o mesmo grep de `FROM <view>`.
--
-- ═══ ALLOWS: nenhum NOVO ════════════════════════════════════════════════════
-- Duas linhas `metric-lint-allow` viajam neste arquivo. As duas ja existiam,
-- palavra por palavra, em migration do repo, e nenhuma delas esta na regiao
-- que esta fatia altera:
--   * get_agenda_events, a cadeia de atribuicao da Source 4 — de 20270831000020.
--   * create_lead_from_social_conversation, o predicado de funil nativo no
--     seed do funil de qualificacao — de 20270817090000.
-- E o arquivo APAGA um allow: o de R3 em get_all_funnels_lead_ids
-- (20270814000000), que existia so para carregar o par slug+type.
--
-- ROLLBACK PAREADO: supabase/migrations/rollback/20270919000020_*.sql — corpos
-- EXATOS de prod de 2026-09-03, sem uma linha editada.

-- ==========================================================================
-- LOTE 1 — utilitarios e leitura simples (5)
--
-- Nao consomem campo projetado nenhum: leem `custom_pipeline_stages` (que e
-- `pipeline_stages` filtrada por funil custom) ou so testam EXISTENCIA de
-- entrada. Vao para a tabela/projecao mais simples que preserva o recorte.
-- ==========================================================================

-- ---- _stage_is_final ---------------------------------------------------
CREATE OR REPLACE FUNCTION public._stage_is_final(p_org_id uuid, p_pipeline_id uuid, p_stage_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT COALESCE(ps.is_final_positive, false) OR COALESCE(ps.is_final_negative, false)
       FROM public.pipeline_stages ps
       JOIN public.pipelines pl ON pl.id = p_pipeline_id AND pl.organization_id = p_org_id
      WHERE ps.pipeline_type = pl.slug
        AND ps.stage_key = p_stage_key
        AND ps.organization_id = p_org_id
      LIMIT 1),
    (SELECT COALESCE(cps.is_final_positive, false) OR COALESCE(cps.is_final_negative, false)
       FROM public.pipeline_stages cps
       JOIN public.pipelines cpl
         ON cpl.id = cps.pipeline_id AND cpl.type = 'custom'
      WHERE cps.pipeline_id = p_pipeline_id
        AND cps.stage_key = p_stage_key
        AND cps.organization_id = p_org_id
      LIMIT 1),
    -- Etapa que não existe em tabela nenhuma (54 em prod) conta como NÃO final:
    -- aparecer no pipeline por engano é visível, sumir dele não é.
    false
  );
$function$;

-- ---- _stage_key_label --------------------------------------------------
CREATE OR REPLACE FUNCTION public._stage_key_label(p_org_id uuid, p_pipeline_id uuid, p_stage_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ps.name
       FROM public.pipeline_stages ps
       JOIN public.pipelines pl ON pl.id = p_pipeline_id AND pl.organization_id = p_org_id
      WHERE ps.pipeline_type = pl.slug
        AND ps.stage_key = p_stage_key
        AND ps.organization_id = p_org_id
      LIMIT 1),
    (SELECT cps.name
       FROM public.pipeline_stages cps
       JOIN public.pipelines cpl
         ON cpl.id = cps.pipeline_id AND cpl.type = 'custom'
      WHERE cps.pipeline_id = p_pipeline_id
        AND cps.stage_key = p_stage_key
        AND cps.organization_id = p_org_id
      LIMIT 1),
    p_stage_key
  );
$function$;

-- ---- metric_stage_role -------------------------------------------------
CREATE OR REPLACE FUNCTION public.metric_stage_role(p_organization_id uuid, p_pipeline_id uuid, p_stage_key text)
 RETURNS stage_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p.type = 'custom' THEN (
      SELECT cps.stage_role FROM public.pipeline_stages cps
      WHERE cps.pipeline_id = p.id AND cps.organization_id = p.organization_id AND cps.stage_key = p_stage_key
    )
    ELSE (
      SELECT ps.stage_role FROM public.pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_type = p.slug AND ps.stage_key = p_stage_key
    )
  END
  FROM public.pipelines p
  WHERE p.id = p_pipeline_id AND p.organization_id = p_organization_id AND p_stage_key IS NOT NULL
$function$;

-- ---- fn_log_pipeline_stage_change_history ------------------------------
CREATE OR REPLACE FUNCTION public.fn_log_pipeline_stage_change_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug       text;
  v_type       text;
  v_pipe_name  text;
  v_stage_name text;
BEGIN
  IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT slug, type, name INTO v_slug, v_type, v_pipe_name
  FROM pipelines WHERE id = NEW.pipeline_id;

  IF v_type = 'custom' THEN
    SELECT name INTO v_stage_name FROM pipeline_stages
     WHERE pipeline_id = NEW.pipeline_id AND stage_key = NEW.stage_key LIMIT 1;
  ELSE
    SELECT name INTO v_stage_name FROM pipeline_stages
     WHERE organization_id = NEW.organization_id
       AND pipeline_type = v_slug AND stage_key = NEW.stage_key LIMIT 1;
  END IF;

  INSERT INTO lead_history (
    lead_id, organization_id, action, description, source, created_by,
    metadata, entity_type, entity_id
  ) VALUES (
    NEW.lead_id,
    NEW.organization_id,
    'stage_changed',
    'Etapa alterada para "' || COALESCE(v_stage_name, NEW.stage_key)
      || '" no funil ' || COALESCE(v_pipe_name, COALESCE(v_slug, 'pipeline')) || ' (automação)',
    'automation',
    NULL,
    jsonb_build_object(
      'pipeline_id', NEW.pipeline_id,
      'pipe_slug', v_slug,
      'to_stage', NEW.stage_key,
      'from_stage', OLD.stage_key,
      'via', 'pipeline_entries_trigger'
    ),
    'lead',
    NEW.lead_id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

-- ---- lead_excluded_from_metrics ----------------------------------------
CREATE OR REPLACE FUNCTION public.lead_excluded_from_metrics(p_lead_id uuid, p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(
      (SELECT (o.feature_flags ->> 'exclude_custom_pipe_leads_from_metrics')::boolean
         FROM organizations o WHERE o.id = p_org_id),
      false
    )
    AND EXISTS (
      SELECT 1 FROM negocio_projetado cpe
      WHERE cpe.pipeline_type = 'custom'
        AND cpe.lead_id = p_lead_id AND cpe.organization_id = p_org_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM negocio_projetado pw
      WHERE pw.funil_sistema = 'whatsapp'
        AND pw.lead_id = p_lead_id AND pw.organization_id = p_org_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM negocio_projetado pc
      WHERE pc.funil_sistema = 'confirmacao'
        AND pc.lead_id = p_lead_id AND pc.organization_id = p_org_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM negocio_projetado pp
      WHERE pp.funil_sistema = 'propostas'
        AND pp.lead_id = p_lead_id AND pp.organization_id = p_org_id
    );
$function$;

-- ==========================================================================
-- LOTE 2 — escrita e manutencao: so as LEITURAS de cada uma (5)
--
-- Estas funcoes ESCREVEM pelos INSTEAD OF das views (DELETE/INSERT). A escrita
-- NAO e migrada aqui — e a SCRUM-639. O que muda e so a leitura (guardas,
-- subselects) que hoje passa pela view.
-- ==========================================================================

-- ---- purge_lead --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_lead(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_org_id uuid;
  v_upsell_ids uuid[];
  v_proposta_ids uuid[];
BEGIN
  IF public.is_master_user() THEN
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  -- Verify lead is in trash (and belongs to caller's org, unless master)
  IF NOT EXISTS(
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id
      AND (v_org_id IS NULL OR organization_id = v_org_id)
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Lead not found in trash';
  END IF;

  -- 1. Upsell chain (ON DELETE RESTRICT — must delete children first)
  SELECT array_agg(uc.id) INTO v_upsell_ids
  FROM public.upsell_clients uc
  WHERE uc.lead_id = p_lead_id;

  IF v_upsell_ids IS NOT NULL THEN
    DELETE FROM public.upsell_orders        WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_campanhas     WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_client_products WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_clients       WHERE id = ANY(v_upsell_ids);
  END IF;

  -- 2. Pipe proposta items (via pipe_propostas)
  SELECT array_agg(pp.id) INTO v_proposta_ids
  FROM public.negocio_projetado pp
  WHERE pp.funil_sistema = 'propostas'
    AND pp.lead_id = p_lead_id;

  IF v_proposta_ids IS NOT NULL THEN
    DELETE FROM public.pipe_proposta_items WHERE pipe_proposta_id = ANY(v_proposta_ids);
  END IF;

  -- 3. All other lead-dependent records
  DELETE FROM public.lead_tags        WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_history     WHERE lead_id = p_lead_id;
  DELETE FROM public.follow_ups       WHERE lead_id = p_lead_id;
  DELETE FROM public.acoes_do_dia     WHERE lead_id = p_lead_id;
  DELETE FROM public.campanha_leads   WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_scores      WHERE lead_id = p_lead_id;
  DELETE FROM public.leads_reativacao WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_whatsapp    WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_confirmacao WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_propostas   WHERE lead_id = p_lead_id;
  DELETE FROM public.custom_pipe_entries WHERE lead_id = p_lead_id;
  DELETE FROM public.pipeline_entries WHERE lead_id = p_lead_id;

  -- 4. Delete the lead itself
  DELETE FROM public.leads WHERE id = p_lead_id;
END;
$function$;

-- ---- delete_pipeline ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_pipeline(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipe      public.pipelines%ROWTYPE;
  v_is_system boolean;
  v_impact    jsonb;
  v_wf        integer := 0;
  v_bp        integer := 0;
  v_cop       integer := 0;
  v_invasores integer := 0;
  v_exemplo   text;
BEGIN
  -- Lock direto na fonte; qualquer tipo de funil.
  SELECT * INTO v_pipe FROM public.pipelines WHERE id = p_pipeline_id FOR UPDATE;

  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  v_is_system := v_pipe.type <> 'custom';

  IF NOT (v_pipe.organization_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  -- Recusa de cards invasores: contrato do mundo custom, preservado por ramo.
  -- O caminho system do baseline nunca recusou (a FK stage_id é SET NULL e o
  -- card invasor sobrevive fantasma) — manter idêntico até a W6 decidir.
  IF NOT v_is_system THEN
    SELECT count(*), min(coalesce(p.name, '(sem nome)') || ' / ' || coalesce(l.name, e.lead_id::text))
      INTO v_invasores, v_exemplo
      FROM public.pipeline_entries e
      JOIN public.pipeline_stages s ON s.id = e.stage_id
      LEFT JOIN public.pipelines p ON p.id = e.pipeline_id
      LEFT JOIN public.leads l     ON l.id = e.lead_id
     WHERE s.pipeline_id = p_pipeline_id
       AND e.pipeline_id <> p_pipeline_id;

    IF v_invasores > 0 THEN
      RAISE EXCEPTION
        'card de outro funil parado numa etapa deste: % card(s), ex. "%". Mova-os para o funil de origem antes de excluir.',
        v_invasores, v_exemplo
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Medir ANTES de apagar — depois os números seriam todos zero.
  v_impact := public.pipeline_delete_impact(p_pipeline_id);

  -- (a) Automações que citam o funil: desativar é honesto (aparecem desligadas
  --     em vez de "ligadas e mortas"). No ramo system o slug também conta.
  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = v_pipe.organization_id
     AND w.is_active
     AND (strpos(w.definition::text, v_pipe.id::text) > 0
       OR strpos(w.trigger_config::text, v_pipe.id::text) > 0
       OR (v_is_system
           AND w.trigger_config->>'filter_pipe' IN (v_pipe.slug, 'pipe_' || v_pipe.slug)));
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- (b) Disparo em voo com destino neste funil (o release diário não revalida
  --     o destino). NULL = "mantém o lead onde está".
  UPDATE public.blast_plans
     SET post_send_target = NULL,
         updated_at = now()
   WHERE organization_id = v_pipe.organization_id
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = v_pipe.id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  IF v_is_system THEN
    -- (c) Agente de IA que operava o funil (active_pipes é chaveado por slug;
    --     nenhum gatilho o limpa).
    UPDATE public.copilot_agents
       SET active_pipes  = active_pipes - v_pipe.slug,
           active_stages = COALESCE(active_stages, '{}'::jsonb) - v_pipe.slug,
           updated_at    = now()
     WHERE organization_id = v_pipe.organization_id
       AND active_pipes ? v_pipe.slug;
    GET DIAGNOSTICS v_cop = ROW_COUNT;

    -- (d) Regras e mensagens em voo, chaveadas por (org, pipe_type).
    --     Passos antes das regras: a FK filha não declara ON DELETE.
    DELETE FROM public.pipe_dispatch_rule_steps
     WHERE rule_id IN (SELECT id FROM public.pipe_dispatch_rules
                        WHERE organization_id = v_pipe.organization_id
                          AND pipe_type = v_pipe.slug);
    DELETE FROM public.pipe_dispatch_rules
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    DELETE FROM public.pipe_distribution_rules
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    DELETE FROM public.scheduled_pipe_messages
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    DELETE FROM public.sla_configs
     WHERE organization_id = v_pipe.organization_id AND pipeline_type = v_pipe.slug;

    -- (e) O ESPELHO NO LEAD, À MÃO — e ANTES dos cards. O gatilho
    --     trg_sync_whatsapp_stage_to_lead existe, mas o baseline provou (1.248
    --     leads medidos) que depender de gatilho aqui é depender de código que
    --     pode não executar (trava de pg_trigger_depth no caminho via view).
    --     O DELETE direto na fonte roda o gatilho em depth 1, e esta linha
    --     continua como cinto de segurança idempotente.
    IF v_pipe.slug = 'whatsapp' THEN
      UPDATE public.leads
         SET pipe_whatsapp = NULL
       WHERE organization_id = v_pipe.organization_id
         AND pipe_whatsapp IS NOT NULL;
    END IF;

    -- (f) Itens de proposta: pipe_proposta_items.pipe_proposta_id NÃO tem FK.
    IF v_pipe.slug = 'propostas' THEN
      DELETE FROM public.pipe_proposta_items
       WHERE pipe_proposta_id IN (SELECT np.id FROM public.negocio_projetado np
                                   WHERE np.funil_sistema = 'propostas'
                                     AND np.organization_id = v_pipe.organization_id);
    END IF;
  END IF;

  -- (g) Os cards, direto na fonte (baseline system apagava via view pipe_*,
  --     que faz exatamente este DELETE por INSTEAD OF; custom já era direto).
  DELETE FROM public.pipeline_entries WHERE pipeline_id = v_pipe.id;

  -- (h) As etapas. Por pipeline_id E, no ramo system, também por
  --     (org, pipeline_type) — cobre as órfãs do backfill da FK, como antes.
  --     Dispara on_pipeline_stage_removed e trg_queue_followup_reclassify.
  DELETE FROM public.pipeline_stages
   WHERE pipeline_id = v_pipe.id
      OR (v_is_system
          AND organization_id = v_pipe.organization_id
          AND pipeline_type = v_pipe.slug);

  -- (i) A linha de registro em pipelines. CASCADE leva o que sobrou de
  --     pipeline_stage_events, custom_pipeline_members e custom_pipe_transitions.
  DELETE FROM public.pipelines WHERE id = v_pipe.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  -- (j) O registro de exibição (só existe no mundo system). É este delete que
  --     impede o funil de voltar via create_default_pipelines.
  IF v_is_system THEN
    DELETE FROM public.pipeline_display_config
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DELETE do registro não afetou nenhuma linha' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_impact || jsonb_build_object(
      'automacoes_desativadas', v_wf,
      'disparos_neutralizados', v_bp,
      'agentes_ajustados',      v_cop
    );
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp
  );
END;
$function$;

-- ---- create_lead_from_social_conversation ------------------------------
CREATE OR REPLACE FUNCTION public.create_lead_from_social_conversation(p_org uuid, p_channel uuid, p_external_user_id text, p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_destination text DEFAULT 'qualificacao'::text, p_campanha_id uuid DEFAULT NULL::uuid, p_custom_pipeline_id uuid DEFAULT NULL::uuid, p_custom_stage_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_channel_type text;
  v_provider     text;
  v_actor        uuid;
  v_is_master    boolean := COALESCE(public.is_master_user(), false);
  v_ext          text := btrim(COALESCE(p_external_user_id, ''));
  v_name         text := btrim(COALESCE(p_name, ''));
  v_dest         text := COALESCE(NULLIF(btrim(COALESCE(p_destination, '')), ''), 'qualificacao');
  v_slug         text;
  v_pipeline_id  uuid;
  v_stage_key    text;
  v_stage_id     uuid;
  v_lead_id      uuid;
  v_identity_id  uuid;
  v_existing_lead uuid;
  v_disp_name    text;
  v_pic          text;
  v_handle       text;
  v_seen         timestamptz;
  v_backfilled   integer;
BEGIN
  -- Gate 1 — org acessível.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT v_is_master) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL OR v_ext = '' THEN
    RAISE EXCEPTION 'channel and external_user_id are required' USING ERRCODE = '22023';
  END IF;

  -- Nome obrigatório NO SERVIDOR. O front pré-preenche, mas um cliente que mande
  -- '' ou '   ' produziria um lead sem rótulo — irreconhecível em qualquer lista.
  IF v_name = '' THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;

  IF v_dest NOT IN ('qualificacao', 'confirmacao', 'propostas', 'campanha', 'custom', 'none') THEN
    RAISE EXCEPTION 'unknown destination: %', v_dest USING ERRCODE = '22023';
  END IF;

  -- Gate 2 — o canal é DESTA org.
  SELECT mc.channel_type, mc.provider
    INTO v_channel_type, v_provider
    FROM public.messaging_channels mc
   WHERE mc.id = p_channel AND mc.organization_id = p_org;

  IF v_channel_type IS NULL THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  -- Gate 4 — CRIAR exige a chave real de permissão, semeada em
  -- supabase/seed.sql:268, que hoje só é checada NO CLIENTE (useCanDo). Vincular
  -- não exige (não há chave equivalente). ⚠️ Isto é MAIS restritivo que o mundo
  -- de hoje: a policy `leads_insert_organization` não checa papel nenhum, então
  -- uma org que desligou "Criar lead" para um membro vai ver o botão falhar AQUI
  -- e continuar funcionando no LeadModal. É inconsistência REAL do produto que
  -- esta fatia EXPÕE — o lado certo de expô-la é o servidor, não o cliente.
  IF NOT COALESCE(public.has_feature_permission('leads.create', p_org), false) THEN
    RAISE EXCEPTION 'forbidden: leads.create' USING ERRCODE = '42501';
  END IF;

  -- A identidade já existe? Então esta conversa JÁ TEM lead, e criar um segundo
  -- seria a duplicata que a chave única existe para impedir.
  SELECT si.lead_id INTO v_existing_lead
    FROM public.lead_social_identities si
   WHERE si.organization_id  = p_org
     AND si.channel_type     = v_channel_type
     AND si.external_user_id = v_ext;

  IF v_existing_lead IS NOT NULL THEN
    RAISE EXCEPTION 'identity_already_linked:%', v_existing_lead USING ERRCODE = 'P0001';
  END IF;

  SELECT tm.id INTO v_actor
    FROM public.team_members tm
   WHERE tm.user_id = v_uid
     AND tm.organization_id = p_org
     AND tm.is_active = true
   LIMIT 1;

  -- Rótulos derivados da última mensagem RECEBIDA (ver o bloco 4).
  SELECT m.sender_name, m.sender_profile_pic, m.contact_handle, m."timestamp"
    INTO v_disp_name, v_pic, v_handle, v_seen
    FROM public.channel_messages m
   WHERE m.organization_id      = p_org
     AND m.messaging_channel_id = p_channel
     AND m.contact_external_id  = v_ext
     AND m.direction            = 'incoming'
   ORDER BY m."timestamp" DESC
   LIMIT 1;

  -- ── Destino: RESOLVIDO ANTES de o lead nascer ───────────────────────────────
  -- Resolver depois deixaria o lead criado e o funil não — o lead invisível que
  -- esta RPC existe para não produzir. Falhar aqui aborta a transação inteira e
  -- não deixa nada meio-feito.
  IF v_dest IN ('qualificacao', 'confirmacao', 'propostas') THEN
    v_slug := CASE v_dest
                WHEN 'qualificacao' THEN 'whatsapp'
                WHEN 'confirmacao'  THEN 'confirmacao'
                ELSE 'propostas'
              END;

    SELECT p.id INTO v_pipeline_id
      FROM public.pipelines p
     WHERE p.organization_id = p_org
       AND p.type = 'system'  -- metric-lint-allow: seed de funil, não métrica
       AND p.slug = v_slug
       AND p.is_active = true
     LIMIT 1;

    IF v_pipeline_id IS NULL THEN
      RAISE EXCEPTION 'destination_unavailable:%', v_dest USING ERRCODE = 'P0001';
    END IF;

    -- Primeira etapa ATIVA do funil, dinâmica (pipeline_stages) — mesma leitura
    -- de `getFirstStageKey` no front. Sem fallback chumbado: se a org não tem
    -- etapa ativa, o card nasceria numa etapa que a tela não desenha.
    SELECT ps.stage_key INTO v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = p_org
       AND ps.pipeline_type   = v_slug
       AND ps.is_active       = true
     ORDER BY ps."position" ASC
     LIMIT 1;

    IF v_stage_key IS NULL THEN
      RAISE EXCEPTION 'destination_unavailable:%', v_dest USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_dest = 'campanha' THEN
    IF p_campanha_id IS NULL THEN
      RAISE EXCEPTION 'campanha_id required for destination campanha' USING ERRCODE = '22023';
    END IF;
    -- Guard de tenant no PARÂMETRO: sem ele, um uuid de campanha de outra org
    -- colocaria o lead no funil do vizinho.
    IF NOT EXISTS (
      SELECT 1 FROM public.campanhas c
       WHERE c.id = p_campanha_id AND c.organization_id = p_org
    ) THEN
      RAISE EXCEPTION 'forbidden: campanha not in org' USING ERRCODE = '42501';
    END IF;

    SELECT cs.id INTO v_stage_id
      FROM public.campanha_stages cs
     WHERE cs.campanha_id = p_campanha_id
     ORDER BY cs."position" ASC
     LIMIT 1;

    IF v_stage_id IS NULL THEN
      RAISE EXCEPTION 'destination_unavailable:campanha' USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_dest = 'custom' THEN
    IF p_custom_pipeline_id IS NULL OR p_custom_stage_id IS NULL THEN
      RAISE EXCEPTION 'custom pipeline and stage required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.pipelines cp
       WHERE cp.type = 'custom'
         AND cp.id = p_custom_pipeline_id
         AND cp.organization_id = p_org
         AND cp.is_active = true
    ) THEN
      RAISE EXCEPTION 'forbidden: custom pipeline not in org' USING ERRCODE = '42501';
    END IF;
    -- Guard de integridade: a etapa tem de ser DESTE funil.
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_stages cps
       WHERE cps.id = p_custom_stage_id
         AND cps.pipeline_id = p_custom_pipeline_id
    ) THEN
      RAISE EXCEPTION 'stage does not belong to pipeline' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Escopo `true` = LOCAL: vale até o fim DESTA transação e não vaza para a
  -- próxima query da mesma conexão (o pooler reusa conexão entre requests).
  -- Vale também para v_dest='none': quem escolheu "nenhum funil" não pode ser
  -- desmentido pelo trigger no COMMIT.
  -- ── DEDUP POR TELEFONE, ANTES DE TENTAR CRIAR ──────────────────────────────
  --
  -- `idx_leads_org_phone_unique (organization_id, normalized_phone) WHERE
  -- deleted_at IS NULL` dispara 23505 e ABORTA A TRANSAÇÃO INTEIRA — nem lead nem
  -- identidade nascem. E o lead que bloqueia pode ser `is_shadow`, que o picker
  -- NUNCA mostra (`useLeads` filtra shadow): o vendedor ficaria num beco, sem
  -- conseguir criar e sem enxergar o que impede.
  --
  -- Em vez de deixar o índice falar por erro cru do Postgres, ADOTAMOS o lead que
  -- já existe: é o mesmo ser humano, e o gêmeo de WhatsApp
  -- (`useWhatsAppLeadIntegration`) faz exatamente isso. A identidade social é então
  -- vinculada a ele, e o shadow é promovido — que é o efeito desejado de alguém
  -- ter finalmente conversado com aquele contato.
  IF NULLIF(btrim(COALESCE(p_phone, '')), '') IS NOT NULL THEN
    SELECT l.id INTO v_lead_id
      FROM public.leads l
     WHERE l.organization_id  = p_org
       AND l.deleted_at IS NULL
       -- ⚠️ `normalize_brazilian_phone` e não normalização própria: é EXATAMENTE a
       -- função que o trigger `trigger_normalize_lead_phone` usa para gravar
       -- `normalized_phone`. Normalizar diferente aqui faria a busca NÃO achar o
       -- lead que o índice único barra segundos depois — dedup falhando em
       -- silêncio e 23505 cru na cara do vendedor.
       AND l.normalized_phone = public.normalize_brazilian_phone(btrim(p_phone))
     LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
      -- Promove shadow: o contato deixou de ser hipótese quando alguém falou com ele.
      UPDATE public.leads
         SET is_shadow = false,
             updated_at = now()
       WHERE id = v_lead_id
         AND is_shadow IS TRUE;

      -- Reusa o caminho de vínculo, que já carrega gate de visibilidade, backfill
      -- do histórico e trilha. Duas escritas do mesmo vínculo em lugares
      -- diferentes divergiriam.
      RETURN public.link_social_conversation_to_lead(
        p_org, p_channel, p_external_user_id, v_lead_id
      );
    END IF;
  END IF;

  PERFORM set_config('app.skip_default_pipe', '1', true);

  INSERT INTO public.leads (
    organization_id, name, company, email, phone, origin,
    responsible_id, sdr_id, is_shadow, notes
  ) VALUES (
    p_org,
    v_name,
    NULLIF(btrim(COALESCE(p_company, '')), ''),
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    -- ⚠️ NULLIF, e não COALESCE(...,''): string vazia aqui colapsaria todos os
    -- contatos de Instagram da org num único lead por normalized_phone.
    NULLIF(btrim(COALESCE(p_phone, '')), ''),
    'instagram',
    v_actor,
    v_actor,
    false,
    'Lead criado a partir de conversa do ' || initcap(v_channel_type)
  )
  RETURNING id INTO v_lead_id;

  -- ── A entry, na MESMA transação ─────────────────────────────────────────────
  IF v_dest IN ('qualificacao', 'confirmacao', 'propostas') THEN
    -- `pipeline_entries` direto, e não a view `pipe_*`: a view é uma projeção que
    -- lê responsável de dentro do metadata. Escrever na tabela com o metadata
    -- montado é o mesmo dado, sem depender do INSTEAD OF.
    INSERT INTO public.pipeline_entries (
      organization_id, pipeline_id, lead_id, stage_key, assigned_to,
      metadata, entered_at, stage_changed_at
    ) VALUES (
      p_org, v_pipeline_id, v_lead_id, v_stage_key, v_actor,
      jsonb_strip_nulls(jsonb_build_object(
        'responsible_id', v_actor,
        'sdr_id',         CASE WHEN v_dest <> 'propostas' THEN v_actor END,
        'closer_id',      CASE WHEN v_dest =  'propostas' THEN v_actor END,
        -- ⚠️ EXPLÍCITO, e não deixado para o trigger. `pipeline_entries_snapshot_responsibles`
        -- faz RETURN NEW assim que QUALQUER uma das quatro chaves de responsável já
        -- está no metadata — e `responsible_id` acima já está. Logo ele nunca
        -- preenche `sale_responsible_id`, e a view `pipe_propostas` lê justamente
        -- essa coluna. Sem isto, o card nasce com o slot de responsável de venda
        -- VAZIO e o negócio some das métricas e comissões por vendedor, que leem
        -- `sale_responsible_id`. O caminho de WhatsApp e o CreateOpportunityModal
        -- setam explicitamente pelo mesmo motivo.
        'sale_responsible_id', CASE WHEN v_dest = 'propostas' THEN v_actor END,
        'created_from',   'social_conversation'
      )),
      now(), now()
    );

  ELSIF v_dest = 'campanha' THEN
    INSERT INTO public.campanha_leads (
      campanha_id, lead_id, stage_id, sdr_id, responsible_id
    ) VALUES (
      p_campanha_id, v_lead_id, v_stage_id, v_actor, v_actor
    );

  ELSIF v_dest = 'custom' THEN
    INSERT INTO public.custom_pipe_entries (
      organization_id, pipeline_id, lead_id, stage_id, assigned_to,
      entered_at, stage_changed_at
    ) VALUES (
      p_org, p_custom_pipeline_id, v_lead_id, p_custom_stage_id, v_actor,
      now(), now()
    );
  END IF;

  -- ── A identidade, na MESMA transação ────────────────────────────────────────
  -- Sem ON CONFLICT: aqui um 23505 é a CORRIDA sendo vencida pelo índice (dois
  -- cliques simultâneos), e o desfecho certo é abortar a transação inteira —
  -- inclusive o lead que ela acabou de criar. Engolir o conflito deixaria um lead
  -- órfão, que é exatamente o dano que a transação única existe para impedir.
  INSERT INTO public.lead_social_identities (
    organization_id, lead_id, provider, channel_type, external_user_id,
    display_name, avatar_url, handle, messaging_channel_id, linked_by, last_seen_at
  ) VALUES (
    p_org, v_lead_id, COALESCE(v_provider, 'notificame'), v_channel_type, v_ext,
    v_disp_name, v_pic, v_handle, p_channel, v_actor, v_seen
  )
  RETURNING id INTO v_identity_id;

  UPDATE public.channel_messages m
     SET lead_id = v_lead_id
   WHERE m.organization_id     = p_org
     AND m.contact_external_id = v_ext
     AND m.messaging_channel_id IN (
       SELECT mc.id FROM public.messaging_channels mc
        WHERE mc.organization_id = p_org
          AND mc.channel_type    = v_channel_type
     )
     AND m.lead_id IS DISTINCT FROM v_lead_id;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, created_by, source, metadata
  ) VALUES (
    v_lead_id, p_org, 'lead_created',
    'Lead criado a partir de conversa do ' || initcap(v_channel_type),
    v_uid, 'manual',
    jsonb_build_object(
      'channel_type', v_channel_type,
      'external_user_id', v_ext,
      'messaging_channel_id', p_channel,
      'destination', v_dest,
      'has_phone', (NULLIF(btrim(COALESCE(p_phone, '')), '') IS NOT NULL),
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  ), (
    v_lead_id, p_org, 'social_identity_linked',
    'Conversa de ' || v_channel_type || ' vinculada a este lead',
    v_uid, 'manual',
    jsonb_build_object(
      'channel_type', v_channel_type,
      'external_user_id', v_ext,
      'messaging_channel_id', p_channel,
      'identity_id', v_identity_id,
      'messages_backfilled', v_backfilled,
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  );

  RETURN v_lead_id;
END;
$function$;

-- ---- fn_auto_assign_lead_default_pipe ----------------------------------
CREATE OR REPLACE FUNCTION public.fn_auto_assign_lead_default_pipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_stage_exists boolean;
  v_manual_only boolean;
BEGIN
  -- (-1) Chamador declarou que já vai colocar o lead num funil nesta mesma
  -- transação (ver import_lead_into_custom_pipeline). O guard (2) abaixo não
  -- cobre esse caso: quando o trigger roda, a entry custom ainda não existe.
  IF coalesce(current_setting('app.skip_default_pipe', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  -- (F) Org optou por "negócio nasce só de clique" (decisões D1 + D7).
  -- Fica ANTES de todo o resto porque é o gate mais largo: org que desligou o
  -- auto-seed não deveria nem consultar pipelines/pipeline_stages. Colocado
  -- DEPOIS de (-1) só porque (-1) é de graça (lê GUC de sessão, não o banco).
  --
  -- Comparação jsonb estrita (`= 'true'::jsonb`), NÃO cast `::boolean`:
  -- espelha `useFeatureFlag` (`=== true`) e não pode levantar 22P02 dentro do
  -- COMMIT — ver cabeçalho, seção "POR QUE A EXPRESSÃO DIFERE DO SKETCH".
  --
  -- Chave ausente → NULL → coalesce → false → semeia como sempre semeou.
  -- Org inexistente (não deveria acontecer: `leads.organization_id` tem FK)
  -- → SELECT INTO não acha linha → v_manual_only fica NULL → coalesce externo
  -- → false. Fail-open deliberado: uma flag de rollout jamais deve ser o
  -- motivo de um lead não entrar na base.
  SELECT coalesce(o.feature_flags -> 'deal_manual_only' = 'true'::jsonb, false)
    INTO v_manual_only
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;

  IF coalesce(v_manual_only, false) THEN
    RETURN NULL;
  END IF;

  -- (0) Cal.com: lead já entra em confirmacao (reunião agendada) — nunca semear whatsapp/novo.
  IF NEW.origin = 'cal' THEN
    RETURN NULL;
  END IF;

  -- (1) já está em pipeline_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.pipeline_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (2) já está em custom_pipe_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.negocio_projetado
    WHERE pipeline_type = 'custom'
      AND lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (3) org tem pipeline system whatsapp ativo?
  SELECT id
    INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND type = 'system' -- metric-lint-allow: não é métrica; é o resolvedor do funil-padrão preservado de prod (ver cabeçalho §DIVERGÊNCIA)
    AND slug = 'whatsapp'
    AND is_active = true
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- (4) stage 'novo' existe e está ativo nesse pipeline?
  SELECT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = NEW.organization_id
      AND pipeline_type = 'whatsapp'
      AND stage_key = 'novo'
      AND is_active = true
  ) INTO v_stage_exists;

  IF NOT v_stage_exists THEN
    RETURN NULL;
  END IF;

  -- (5) cria entry whatsapp/novo
  INSERT INTO public.pipeline_entries (
    organization_id,
    pipeline_id,
    lead_id,
    stage_key,
    entered_at,
    stage_changed_at
  ) VALUES (
    NEW.organization_id,
    v_pipeline_id,
    NEW.id,
    'novo',
    NOW(),
    NOW()
  );

  RETURN NULL;
END;
$function$;

-- ---- import_lead_into_custom_pipeline ----------------------------------
CREATE OR REPLACE FUNCTION public.import_lead_into_custom_pipeline(p_organization_id uuid, p_lead jsonb, p_pipeline_id uuid, p_stage_id uuid, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- Guard de tenant: o funil tem que ser da org que está importando. Sem isto,
  -- um organization_id de uma org e um pipeline_id de outra criariam o card no
  -- funil do vizinho.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines
    WHERE type = 'custom'
      AND id = p_pipeline_id
      AND organization_id = p_organization_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Pipeline custom % não pertence à organização % ou está inativo',
      p_pipeline_id, p_organization_id;
  END IF;

  -- Guard de integridade: a etapa tem que ser DESTE funil.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE id = p_stage_id
      AND pipeline_id = p_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Etapa % não pertence ao pipeline %', p_stage_id, p_pipeline_id;
  END IF;

  -- Guard de tenant no responsável: impede carimbar um membro de outra org.
  IF p_assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE id = p_assigned_to
      AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização %',
      p_assigned_to, p_organization_id;
  END IF;

  -- Escopo `true` = LOCAL: vale só até o fim desta transação. Não vaza pra
  -- próxima query da mesma conexão (pooler reusa conexão entre requests).
  PERFORM set_config('app.skip_default_pipe', '1', true);

  INSERT INTO public.leads (
    organization_id, name, company, phone, email,
    faturamento, segment, notes, origin, rating,
    utm_campaign, utm_source, utm_medium, utm_content, utm_term,
    responsible_id, sdr_id
  ) VALUES (
    p_organization_id,
    p_lead->>'name',
    p_lead->>'company',
    p_lead->>'phone',
    p_lead->>'email',
    p_lead->>'faturamento',
    p_lead->>'segment',
    p_lead->>'notes',
    coalesce((p_lead->>'origin')::public.lead_origin, 'outro'::public.lead_origin),
    coalesce((p_lead->>'rating')::int, 0),
    p_lead->>'utm_campaign',
    p_lead->>'utm_source',
    p_lead->>'utm_medium',
    p_lead->>'utm_content',
    p_lead->>'utm_term',
    p_assigned_to,
    p_assigned_to
  )
  RETURNING id INTO v_lead_id;

  INSERT INTO public.custom_pipe_entries (
    organization_id, pipeline_id, lead_id, stage_id, assigned_to,
    entered_at, stage_changed_at
  ) VALUES (
    p_organization_id, p_pipeline_id, v_lead_id, p_stage_id, p_assigned_to,
    NOW(), NOW()
  );

  RETURN v_lead_id;
END;
$function$;

-- ==========================================================================
-- LOTE 3 — agenda e publico (3)
--
-- Leem campo projetado de verdade (meeting_date, sdr_id, closer_id, notes) ou
-- resolvem publico de disparo. Aqui a projecao paga: `funil_sistema` substitui
-- o par slug+type e APAGA o `metric-lint-allow` de R3 que get_all_funnels
-- carregava so para escrever aquele par.
-- ==========================================================================

-- ---- get_agenda_events -------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_agenda_events(p_organization_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(id uuid, source text, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, all_day boolean, event_type text, status text, lead_id uuid, lead_name text, lead_company text, created_by uuid, creator_name text, location text, meet_link text, color text, google_event_id text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY

  -- Source 1: meetings
  SELECT
    m.id, 'meeting'::text, m.title, m.description, m.start_at, m.end_at,
    m.all_day, m.event_type, m.status, m.lead_id, l.name, l.company,
    m.created_by, tm.name, m.location, m.meet_link, m.color, m.google_event_id
  FROM public.meetings m
  LEFT JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN public.team_members tm
    ON tm.user_id = m.created_by
   AND tm.organization_id = m.organization_id
  WHERE m.organization_id = p_organization_id
    AND m.start_at < p_end
    AND m.end_at > p_start

  UNION ALL

  -- Source 2: follow_ups
  SELECT
    fu.id, 'follow_up'::text, fu.title, fu.description, fu.due_date,
    fu.due_date + interval '30 minutes', false, 'follow_up'::text,
    CASE WHEN fu.completed_at IS NOT NULL THEN 'completed' ELSE 'scheduled' END,
    fu.lead_id, l2.name, l2.company, fu.assigned_to, tm2.name,
    NULL::text, NULL::text, NULL::text, NULL::text
  FROM public.follow_ups fu
  LEFT JOIN public.leads l2 ON l2.id = fu.lead_id
  LEFT JOIN public.team_members tm2 ON tm2.id = fu.assigned_to
  WHERE fu.organization_id = p_organization_id
    AND fu.archived_at IS NULL
    AND fu.due_date >= p_start
    AND fu.due_date < p_end

  UNION ALL

  -- Source 3: scheduled_user_messages
  SELECT
    sm.id, 'scheduled_message'::text,
    COALESCE(LEFT(sm.message_content, 60), 'Mensagem agendada'),
    sm.message_content, sm.scheduled_at, sm.scheduled_at + interval '5 minutes',
    false, 'task'::text, sm.status, sm.lead_id, l3.name, l3.company,
    sm.created_by, tm3.name, NULL::text, NULL::text, NULL::text, NULL::text
  FROM public.scheduled_user_messages sm
  LEFT JOIN public.leads l3 ON l3.id = sm.lead_id
  LEFT JOIN public.team_members tm3 ON tm3.id = sm.created_by
  WHERE sm.organization_id = p_organization_id
    AND sm.status IN ('scheduled', 'sending')
    AND sm.scheduled_at >= p_start
    AND sm.scheduled_at < p_end

  UNION ALL

  -- Source 4: pipe_confirmacao
  SELECT
    pc.id, 'pipe_confirmacao'::text, COALESCE(l4.name, 'Reuniao'), pc.notes,
    pc.meeting_date, pc.meeting_date + interval '1 hour', false, 'meeting'::text,
    pc.stage_key::text, pc.lead_id, l4.name, l4.company,
    COALESCE(pc.closer_id, pc.sdr_id), -- metric-lint-allow: agenda não é métrica de atribuição; preservado byte-a-byte de 20270831000020
    COALESCE(tm_closer.name, tm_sdr.name),
    NULL::text, NULL::text, NULL::text, NULL::text
  FROM public.negocio_projetado pc
  LEFT JOIN public.leads l4 ON l4.id = pc.lead_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = pc.closer_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = pc.sdr_id
  WHERE pc.funil_sistema = 'confirmacao'
    AND pc.organization_id = p_organization_id
    AND pc.meeting_date IS NOT NULL
    AND pc.meeting_date >= p_start
    AND pc.meeting_date < p_end
    -- 🚨 A guarda nova. A Source 5 já tinha a dela desde 20270831000020; a
    -- Source 4 não, e sem isto toda reunião migrada para `meetings` aparecia
    -- duas vezes na mesma grade.
    AND NOT EXISTS (
      SELECT 1 FROM public.meetings m4
      WHERE m4.lead_id = pc.lead_id AND m4.start_at = pc.meeting_date
    )

  UNION ALL

  -- Source 5: meeting_events (funil mergeado)
  SELECT
    me.id, 'meeting_event'::text, COALESCE(l5.name, 'Reuniao'), NULL::text,
    me.meeting_date, me.meeting_date + interval '1 hour', false, 'meeting'::text,
    me.held_status, me.lead_id, l5.name, l5.company,
    me.pre_sale_responsible_id, tm5.name,
    NULL::text, NULL::text, NULL::text, NULL::text
  FROM (
    SELECT DISTINCT ON (e.lead_id, e.meeting_date)
      e.id, e.lead_id, e.meeting_date, e.pre_sale_responsible_id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.meeting_events h
          WHERE h.booked_event_id = e.id AND h.event_type = 'meeting_held'
        ) THEN 'completed'
        ELSE 'scheduled'
      END AS held_status
    FROM public.meeting_events e
    WHERE e.organization_id = p_organization_id
      AND e.event_type = 'meeting_booked'
      AND e.meeting_date IS NOT NULL
      AND e.source IS DISTINCT FROM 'pipeline:confirmacao'
      AND (e.source IS NULL OR e.source NOT LIKE 'backfill:%')
      AND e.meeting_date >= p_start
      AND e.meeting_date < p_end
    ORDER BY e.lead_id, e.meeting_date, e.occurred_at DESC
  ) me
  LEFT JOIN public.leads l5 ON l5.id = me.lead_id
  LEFT JOIN public.team_members tm5 ON tm5.id = me.pre_sale_responsible_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.negocio_projetado pc2
    WHERE pc2.funil_sistema = 'confirmacao'
      AND pc2.lead_id = me.lead_id AND pc2.meeting_date = me.meeting_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.meetings m2
    WHERE m2.lead_id = me.lead_id AND m2.start_at = me.meeting_date
  )

  ORDER BY start_at ASC;
END;
$function$;

-- ---- get_agenda_events_scoped ------------------------------------------
CREATE OR REPLACE FUNCTION public.get_agenda_events_scoped(p_organization_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(id uuid, source text, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, all_day boolean, event_type text, status text, lead_id uuid, lead_name text, lead_company text, created_by uuid, creator_name text, location text, meet_link text, color text, google_event_id text, owner_team_member_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me         uuid;
  v_scope_mine boolean;
BEGIN
  -- Tenancy: a função base é SECURITY INVOKER e as policies das 5 fontes são
  -- todas por organização, então o isolamento entre orgs continua sendo o do
  -- RLS. Este gate só devolve erro cedo e legível em vez de lista vazia.
  IF p_organization_id IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_organization_id)
         AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  v_me := public.my_team_member_id(p_organization_id);

  -- `is_org_admin` primeiro, e não só `has_feature_permission`: master e gestor
  -- de portfólio NÃO têm linha em `team_members`, e `has_feature_permission`
  -- devolve `false` para quem não tem linha. Sem este OR, quem opera a org de
  -- fora cairia no recorte com `v_me = NULL` e veria só os órfãos.
  v_scope_mine := NOT public.is_org_admin(p_organization_id)
              AND NOT COALESCE(
                    public.has_feature_permission('agenda.view_all', p_organization_id),
                    false);

  RETURN QUERY
  WITH base AS (
    SELECT e.*,
           CASE
             -- Source 1 é a única em espaço de auth.users: resolve pela ponte.
             WHEN e.source = 'meeting' THEN (
               SELECT tm.id FROM public.team_members tm
               WHERE tm.user_id         = e.created_by
                 AND tm.organization_id = p_organization_id
               LIMIT 1
             )
             -- As outras 4 já vêm em team_members.id.
             ELSE e.created_by
           END AS owner_tm
    FROM public.get_agenda_events(p_organization_id, p_start, p_end) e
  )
  SELECT b.id, b.source, b.title, b.description, b.start_at, b.end_at,
         b.all_day, b.event_type, b.status, b.lead_id, b.lead_name,
         b.lead_company, b.created_by, b.creator_name, b.location,
         b.meet_link, b.color, b.google_event_id,
         b.owner_tm
  FROM base b
  WHERE NOT v_scope_mine
     -- é meu
     OR (v_me IS NOT NULL AND b.owner_tm = v_me)
     -- não é de ninguém
     OR b.owner_tm IS NULL
     -- fui convidado para a reunião
     OR (b.source = 'meeting' AND v_me IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.meeting_participants mp
           WHERE mp.meeting_id     = b.id
             AND mp.team_member_id = v_me))
     -- eu marquei, mas o COALESCE deu o crédito ao closer
     OR (b.source = 'pipe_confirmacao' AND v_me IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.negocio_projetado pc
           WHERE pc.funil_sistema = 'confirmacao'
             AND pc.id     = b.id
             AND pc.sdr_id = v_me))
  ORDER BY b.start_at ASC;
END;
$function$;

-- ---- get_all_funnels_lead_ids ------------------------------------------
CREATE OR REPLACE FUNCTION public.get_all_funnels_lead_ids(p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH entry_leads AS (
    -- Ramo 1: funis system (pipeline_entries + pipelines).
    SELECT pe.lead_id
    FROM public.negocio_projetado pe
    WHERE pe.funil_sistema IN ('whatsapp', 'confirmacao', 'propostas')
      AND pe.lead_id IS NOT NULL
      -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
      AND (
        pe.organization_id IN (SELECT public.get_my_organization_ids())
        OR (p_organization_id IS NOT NULL
            AND public.is_master_user()
            AND pe.organization_id = p_organization_id)
      )
      -- ESCOPO (SCRUM-429) — ramo 1.
      AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id)

    UNION

    -- Ramo 2: funis custom, pela projeção (pipeline_type = 'custom' é o mesmo
    -- recorte que a view custom_pipe_entries fazia pelo JOIN em pipelines).
    SELECT ce.lead_id
    FROM public.negocio_projetado ce
    WHERE ce.pipeline_type = 'custom'
      AND ce.lead_id IS NOT NULL
      -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
      AND (
        ce.organization_id IN (SELECT public.get_my_organization_ids())
        OR (p_organization_id IS NOT NULL
            AND public.is_master_user()
            AND ce.organization_id = p_organization_id)
      )
      -- ESCOPO (SCRUM-429) — ramo 2. Precisa existir nos DOIS.
      AND (p_organization_id IS NULL OR ce.organization_id = p_organization_id)
  )
  SELECT el.lead_id
  FROM entry_leads el
  JOIN public.leads l
    ON l.id = el.lead_id
   AND l.deleted_at IS NULL
  WHERE
    -- Tag filter (intersection: lead must have ALL specified tags).
    (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt.tag_id FROM public.lead_tags lt WHERE lt.lead_id = l.id
    ))
    -- Qualification tier (sale-side) — text membership, NULL/empty = all.
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL
      OR l.qualification_tier::text = ANY(p_qualification_tier))
    -- Pre-qualification tier — text membership, NULL/empty = all.
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL
      OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    -- Origin — text membership, NULL/empty = all.
    AND (p_origin IS NULL OR array_length(p_origin, 1) IS NULL
      OR l.origin::text = ANY(p_origin));
$function$;

-- ==========================================================================
-- LOTE 4 — analytics (2 das 12; ver §BARREIRA)
--
-- As unicas duas do grupo de analytics cujo corpo pode ser reemitido sem
-- acionar `ledger-revenue`/R4/R5 do check-metric-antipatterns.sh. As outras 10
-- estao listadas na §BARREIRA com o motivo medido de cada uma.
-- ==========================================================================

-- ---- get_product_ranking -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_ranking(p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  SELECT COALESCE(jsonb_agg(row_to_json(ranked) ORDER BY ranked.total_value DESC), '[]'::jsonb)
  INTO result
  FROM (
    SELECT p.id AS product_id, p.name AS product_name, p.type AS product_type,
      COUNT(DISTINCT pp.id) AS qty_sold,
      SUM(it.valor) AS total_value,
      CASE WHEN COUNT(DISTINCT pp.id) > 0
        THEN ROUND(SUM(it.valor) / COUNT(DISTINCT pp.id), 2) ELSE 0 END AS ticket_medio
    FROM negocio_projetado pp
    LEFT JOIN deals d ON d.id = pp.deal_id AND d.deleted_at IS NULL
    -- Preferência por entrada: o caderno do Negócio manda; o antigo só cobre
    -- a entrada cujo Negócio não tem item nenhum. Nunca os dois.
    CROSS JOIN LATERAL (
      SELECT di.product_id, di.total AS valor
      FROM deal_items di
      WHERE di.deal_id = d.id
      UNION ALL
      SELECT ppi.product_id, COALESCE(ppi.sale_value, 0)
      FROM pipe_proposta_items ppi
      WHERE ppi.pipe_proposta_id = pp.id
        AND NOT EXISTS (SELECT 1 FROM deal_items di2 WHERE di2.deal_id = d.id)
    ) it
    JOIN products p ON p.id = it.product_id
    WHERE pp.funil_sistema = 'propostas'
      AND pp.organization_id = p_org_id AND pp.stage_key = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
    GROUP BY p.id, p.name, p.type ORDER BY total_value DESC LIMIT 10
  ) ranked;
  RETURN result;
END; $function$;

-- ---- get_analytics_engagement_metrics ----------------------------------
CREATE OR REPLACE FUNCTION public.get_analytics_engagement_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  WITH
  -- -----------------------------------------------------------------------
  -- Base: leads in period
  -- -----------------------------------------------------------------------
  period_leads AS (
    SELECT l.id AS lead_id, l.origin, l.created_at
    FROM leads l
    WHERE l.organization_id = p_org_id
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  ),

  -- -----------------------------------------------------------------------
  -- Messages within period, filtered to leads in scope
  -- -----------------------------------------------------------------------
  scope_messages AS (
    SELECT
      wm.id,
      wm.lead_id,
      wm.direction,
      wm.timestamp::timestamptz AS ts,
      wm.assigned_to
    FROM whatsapp_messages wm
    INNER JOIN period_leads pl ON pl.lead_id = wm.lead_id
    WHERE wm.organization_id = p_org_id
      AND wm.timestamp IS NOT NULL
      AND wm.lead_id IS NOT NULL
  ),

  -- -----------------------------------------------------------------------
  -- Our response time: for each inbound, find the next outbound to same lead
  -- Only during business hours (8-19) to avoid overnight gaps
  -- -----------------------------------------------------------------------
  inbound_msgs AS (
    SELECT id, lead_id, ts
    FROM scope_messages
    WHERE direction = 'incoming'
      AND EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18
  ),
  outbound_next AS (
    SELECT DISTINCT ON (i.id)
      i.id   AS inbound_id,
      i.lead_id,
      EXTRACT(EPOCH FROM (o.ts - i.ts)) AS response_seconds
    FROM inbound_msgs i
    JOIN scope_messages o
      ON  o.lead_id   = i.lead_id
      AND o.direction = 'outgoing'
      AND o.ts > i.ts
      AND o.ts < i.ts + interval '12 hours'
    ORDER BY i.id, o.ts
  ),

  -- -----------------------------------------------------------------------
  -- Client response time: for each outbound, next inbound from same lead
  -- -----------------------------------------------------------------------
  outbound_msgs AS (
    SELECT id, lead_id, ts
    FROM scope_messages
    WHERE direction = 'outgoing'
      AND EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18
  ),
  inbound_next AS (
    SELECT DISTINCT ON (o.id)
      o.id   AS outbound_id,
      o.lead_id,
      EXTRACT(EPOCH FROM (i.ts - o.ts)) AS response_seconds
    FROM outbound_msgs o
    JOIN scope_messages i
      ON  i.lead_id   = o.lead_id
      AND i.direction = 'incoming'
      AND i.ts > o.ts
      AND i.ts < o.ts + interval '24 hours'
    ORDER BY o.id, i.ts
  ),

  -- -----------------------------------------------------------------------
  -- KPI: response_rate (leads with >= 1 inbound reply)
  -- -----------------------------------------------------------------------
  leads_with_inbound AS (
    SELECT COUNT(DISTINCT sm.lead_id) AS cnt
    FROM scope_messages sm
    WHERE sm.direction = 'incoming'
  ),

  -- -----------------------------------------------------------------------
  -- KPI: close_rate (vendido proposals)
  -- -----------------------------------------------------------------------
  period_proposals AS (
    SELECT pp.lead_id, pp.stage_key AS status
    FROM negocio_projetado pp
    INNER JOIN period_leads pl ON pl.lead_id = pp.lead_id
    WHERE pp.funil_sistema = 'propostas'
      AND pp.organization_id = p_org_id
  ),
  total_leads_cnt   AS (SELECT COUNT(*) AS cnt FROM period_leads),
  vendido_cnt       AS (SELECT COUNT(DISTINCT lead_id) AS cnt FROM period_proposals WHERE status = 'vendido'),

  -- -----------------------------------------------------------------------
  -- KPI cards
  -- -----------------------------------------------------------------------
  kpi AS (
    SELECT
      COALESCE(AVG(on2.response_seconds), 0) AS our_avg_response_seconds,
      COALESCE(AVG(inn.response_seconds), 0) AS client_avg_response_seconds,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND((SELECT cnt FROM leads_with_inbound)::numeric
              / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END                            AS response_rate_pct,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND((SELECT cnt FROM vendido_cnt)::numeric
              / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END                            AS close_rate_pct
    FROM outbound_next on2
    FULL OUTER JOIN inbound_next inn ON false
  ),

  -- -----------------------------------------------------------------------
  -- response_by_origin
  -- -----------------------------------------------------------------------
  origin_leads AS (
    SELECT
      pl.origin::text                        AS origin,
      COUNT(DISTINCT pl.lead_id)             AS lead_count,
      COUNT(DISTINCT sm_in.lead_id)          AS replied_count,
      COUNT(DISTINCT pp2.lead_id) FILTER (WHERE pp2.status = 'vendido') AS sales_count,
      COALESCE(AVG(on3.response_seconds), 0) AS avg_response_seconds
    FROM period_leads pl
    LEFT JOIN scope_messages sm_in
      ON sm_in.lead_id  = pl.lead_id AND sm_in.direction = 'incoming'
    LEFT JOIN period_proposals pp2
      ON pp2.lead_id = pl.lead_id
    LEFT JOIN outbound_next on3
      ON on3.lead_id = pl.lead_id
    GROUP BY pl.origin::text
    HAVING COUNT(DISTINCT pl.lead_id) >= 3
  ),
  response_by_origin AS (
    SELECT
      origin,
      lead_count,
      sales_count,
      CASE WHEN lead_count > 0 THEN ROUND(replied_count::numeric / lead_count * 100, 1) ELSE 0 END AS response_rate,
      CASE WHEN lead_count > 0 THEN ROUND(sales_count::numeric  / lead_count * 100, 1) ELSE 0 END AS close_rate,
      ROUND(avg_response_seconds::numeric, 0) AS avg_response_seconds
    FROM origin_leads
    ORDER BY response_rate DESC
  ),

  -- -----------------------------------------------------------------------
  -- team_response_times
  -- -----------------------------------------------------------------------
  member_response AS (
    SELECT
      tm.id   AS member_id,
      tm.name AS member_name,
      false   AS is_copilot,
      COALESCE(AVG(on4.response_seconds), 0) AS avg_response_seconds
    FROM team_members tm
    LEFT JOIN scope_messages sm_out
      ON sm_out.assigned_to = tm.user_id AND sm_out.direction = 'outgoing'
    LEFT JOIN outbound_next on4
      ON on4.inbound_id IN (
        SELECT id FROM inbound_msgs WHERE lead_id = sm_out.lead_id
      )
    WHERE tm.organization_id = p_org_id
      AND tm.is_active = true
      AND (p_member_id IS NULL OR tm.id = p_member_id)
    GROUP BY tm.id, tm.name
  ),

  -- -----------------------------------------------------------------------
  -- hourly_pattern: when do clients respond most?
  -- -----------------------------------------------------------------------
  hourly_pattern AS (
    SELECT
      EXTRACT(HOUR FROM sm.ts)::int AS hour,
      COUNT(*) AS response_count
    FROM scope_messages sm
    WHERE sm.direction = 'incoming'
    GROUP BY EXTRACT(HOUR FROM sm.ts)::int
    ORDER BY hour
  ),
  total_inbound_cnt AS (
    SELECT COUNT(*) AS cnt FROM scope_messages WHERE direction = 'incoming'
  ),
  hourly_with_rate AS (
    SELECT
      hp.hour,
      hp.response_count,
      CASE WHEN (SELECT cnt FROM total_inbound_cnt) > 0
        THEN ROUND(hp.response_count::numeric / (SELECT cnt FROM total_inbound_cnt) * 100, 1)
        ELSE 0 END AS response_rate
    FROM hourly_pattern hp
  ),

  -- -----------------------------------------------------------------------
  -- speed_conversion buckets
  -- -----------------------------------------------------------------------
  lead_first_response AS (
    SELECT DISTINCT ON (on5.lead_id)
      on5.lead_id,
      on5.response_seconds
    FROM outbound_next on5
    ORDER BY on5.lead_id, on5.response_seconds
  ),
  lead_first_response_status AS (
    SELECT lfr.lead_id, lfr.response_seconds,
      EXISTS (
        SELECT 1 FROM period_proposals pp3
        WHERE pp3.lead_id = lfr.lead_id AND pp3.status = 'vendido'
      ) AS converted
    FROM lead_first_response lfr
  ),
  speed_buckets AS (
    SELECT
      bucket_label,
      bucket_min,
      bucket_max,
      COUNT(*) FILTER (WHERE response_seconds >= bucket_min AND response_seconds < bucket_max) AS lead_count,
      COUNT(*) FILTER (WHERE response_seconds >= bucket_min AND response_seconds < bucket_max AND converted) AS converted_count
    FROM lead_first_response_status,
    (VALUES
      ('<2min',   0,    120),
      ('2-5min',  120,  300),
      ('5-15min', 300,  900),
      ('>15min',  900,  999999)
    ) AS b(bucket_label, bucket_min, bucket_max)
    GROUP BY bucket_label, bucket_min, bucket_max
  ),
  speed_conversion AS (
    SELECT
      bucket_label,
      bucket_min AS bucket_min_seconds,
      CASE WHEN bucket_max = 999999 THEN NULL ELSE bucket_max END AS bucket_max_seconds,
      lead_count,
      converted_count,
      CASE WHEN lead_count > 0
        THEN ROUND(converted_count::numeric / lead_count * 100, 1)
        ELSE 0 END AS conversion_rate
    FROM speed_buckets
    ORDER BY bucket_min
  ),

  -- -----------------------------------------------------------------------
  -- monthly_trends (last 6 months)
  -- -----------------------------------------------------------------------
  month_series AS (
    SELECT generate_series(
      date_trunc('month', (p_end_date - interval '5 months')::timestamp),
      date_trunc('month', p_end_date::timestamp),
      interval '1 month'
    ) AS month_start
  ),
  monthly_leads AS (
    SELECT
      date_trunc('month', COALESCE(l.metrics_period_at, l.created_at)) AS month_start,
      COUNT(DISTINCT l.id)              AS lead_count
    FROM leads l
    WHERE l.organization_id = p_org_id
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND COALESCE(l.metrics_period_at, l.created_at) >= (p_end_date - interval '6 months')
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
    GROUP BY date_trunc('month', COALESCE(l.metrics_period_at, l.created_at))
  ),
  monthly_inbound AS (
    SELECT
      date_trunc('month', wm.timestamp::timestamptz) AS month_start,
      COUNT(DISTINCT wm.lead_id) AS replied_leads
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'incoming'
      AND wm.timestamp IS NOT NULL
      AND wm.timestamp::timestamptz >= (p_end_date - interval '6 months')
      AND wm.timestamp::timestamptz < (p_end_date + interval '1 day')
    GROUP BY date_trunc('month', wm.timestamp::timestamptz)
  ),
  monthly_closed AS (
    SELECT
      date_trunc('month', pp.closed_at) AS month_start,
      COUNT(DISTINCT pp.lead_id) AS vendido_count
    FROM negocio_projetado pp
    WHERE pp.funil_sistema = 'propostas'
      AND pp.organization_id = p_org_id
      AND pp.stage_key = 'vendido'
      AND pp.closed_at IS NOT NULL
      AND pp.closed_at >= (p_end_date - interval '6 months')
      AND pp.closed_at < (p_end_date + interval '1 day')
    GROUP BY date_trunc('month', pp.closed_at)
  ),
  monthly_our_resp AS (
    SELECT
      date_trunc('month', i.ts) AS month_start,
      AVG(on6.response_seconds) AS avg_our_seconds
    FROM inbound_msgs i
    JOIN outbound_next on6 ON on6.inbound_id = i.id
    WHERE i.ts >= (p_end_date::timestamptz - interval '6 months')
    GROUP BY date_trunc('month', i.ts)
  ),
  monthly_client_resp AS (
    SELECT
      date_trunc('month', o.ts) AS month_start,
      AVG(inn2.response_seconds) AS avg_client_seconds
    FROM outbound_msgs o
    JOIN inbound_next inn2 ON inn2.outbound_id = o.id
    WHERE o.ts >= (p_end_date::timestamptz - interval '6 months')
    GROUP BY date_trunc('month', o.ts)
  ),
  monthly_trends AS (
    SELECT
      to_char(ms.month_start, 'Mon/YY') AS month_label,
      CASE WHEN COALESCE(ml.lead_count, 0) > 0
        THEN ROUND(COALESCE(mi.replied_leads, 0)::numeric / ml.lead_count * 100, 1)
        ELSE 0 END AS response_rate,
      ROUND(COALESCE(mor.avg_our_seconds, 0)::numeric, 0)    AS our_avg_response_seconds,
      ROUND(COALESCE(mcr.avg_client_seconds, 0)::numeric, 0) AS client_avg_response_seconds,
      CASE WHEN COALESCE(ml.lead_count, 0) > 0
        THEN ROUND(COALESCE(mc.vendido_count, 0)::numeric / ml.lead_count * 100, 1)
        ELSE 0 END AS close_rate
    FROM month_series ms
    LEFT JOIN monthly_leads      ml  ON ml.month_start  = ms.month_start
    LEFT JOIN monthly_inbound    mi  ON mi.month_start  = ms.month_start
    LEFT JOIN monthly_closed     mc  ON mc.month_start  = ms.month_start
    LEFT JOIN monthly_our_resp   mor ON mor.month_start = ms.month_start
    LEFT JOIN monthly_client_resp mcr ON mcr.month_start = ms.month_start
    ORDER BY ms.month_start
  ),

  -- -----------------------------------------------------------------------
  -- copilot_vs_human
  -- (copilot messages = processed_by_agent_at IS NOT NULL)
  -- -----------------------------------------------------------------------
  copilot_outbound AS (
    SELECT wm.lead_id, wm.id, wm.timestamp::timestamptz AS ts
    FROM whatsapp_messages wm
    INNER JOIN period_leads pl ON pl.lead_id = wm.lead_id
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'outgoing'
      AND wm.processed_by_agent_at IS NOT NULL
      AND wm.timestamp IS NOT NULL
  ),
  human_outbound AS (
    SELECT wm.lead_id, wm.id, wm.timestamp::timestamptz AS ts
    FROM whatsapp_messages wm
    INNER JOIN period_leads pl ON pl.lead_id = wm.lead_id
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'outgoing'
      AND wm.processed_by_agent_at IS NULL
      AND wm.timestamp IS NOT NULL
  ),
  copilot_first_resp AS (
    SELECT DISTINCT ON (co.lead_id)
      co.lead_id,
      EXTRACT(EPOCH FROM (co.ts - sm_in2.ts)) AS response_seconds
    FROM copilot_outbound co
    JOIN scope_messages sm_in2
      ON sm_in2.lead_id   = co.lead_id
      AND sm_in2.direction = 'incoming'
      AND sm_in2.ts < co.ts
      AND sm_in2.ts > co.ts - interval '12 hours'
    ORDER BY co.lead_id, co.ts
  ),
  human_first_resp AS (
    SELECT DISTINCT ON (hu.lead_id)
      hu.lead_id,
      EXTRACT(EPOCH FROM (hu.ts - sm_in3.ts)) AS response_seconds
    FROM human_outbound hu
    JOIN scope_messages sm_in3
      ON sm_in3.lead_id   = hu.lead_id
      AND sm_in3.direction = 'incoming'
      AND sm_in3.ts < hu.ts
      AND sm_in3.ts > hu.ts - interval '12 hours'
    ORDER BY hu.lead_id, hu.ts
  ),
  copilot_stats AS (
    SELECT
      COALESCE(AVG(cfr.response_seconds), 0) AS avg_response,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT co.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS response_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT co.lead_id) FILTER (WHERE EXISTS (
          SELECT 1 FROM scope_messages WHERE lead_id = co.lead_id AND direction = 'incoming'
        ))::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS qualification_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT co.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS coverage_pct,
      0 AS cost_per_lead
    FROM copilot_outbound co
    LEFT JOIN copilot_first_resp cfr ON cfr.lead_id = co.lead_id
  ),
  human_stats AS (
    SELECT
      COALESCE(AVG(hfr.response_seconds), 0) AS avg_response,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT hu.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS response_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT hu.lead_id) FILTER (WHERE EXISTS (
          SELECT 1 FROM scope_messages WHERE lead_id = hu.lead_id AND direction = 'incoming'
        ))::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS qualification_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT hu.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS coverage_pct,
      0 AS cost_per_lead
    FROM human_outbound hu
    LEFT JOIN human_first_resp hfr ON hfr.lead_id = hu.lead_id
  )

  SELECT jsonb_build_object(
    'kpi_cards', COALESCE((
      SELECT jsonb_build_object(
        'our_avg_response_seconds',    ROUND(our_avg_response_seconds::numeric, 0),
        'client_avg_response_seconds', ROUND(client_avg_response_seconds::numeric, 0),
        'response_rate_pct',           response_rate_pct,
        'close_rate_pct',              close_rate_pct
      )
      FROM kpi
      LIMIT 1
    ), '{"our_avg_response_seconds":0,"client_avg_response_seconds":0,"response_rate_pct":0,"close_rate_pct":0}'::jsonb),
    'response_by_origin',  COALESCE((SELECT jsonb_agg(row_to_json(rbo)) FROM response_by_origin rbo), '[]'::jsonb),
    'team_response_times', COALESCE((SELECT jsonb_agg(row_to_json(mr))  FROM member_response mr),      '[]'::jsonb),
    'hourly_pattern',      COALESCE((SELECT jsonb_agg(row_to_json(hw))  FROM hourly_with_rate hw),      '[]'::jsonb),
    'speed_conversion',    COALESCE((SELECT jsonb_agg(row_to_json(sc))  FROM speed_conversion sc),      '[]'::jsonb),
    'monthly_trends',      COALESCE((SELECT jsonb_agg(row_to_json(mt))  FROM monthly_trends mt),        '[]'::jsonb),
    'copilot_vs_human', jsonb_build_object(
      'copilot', (SELECT row_to_json(cs) FROM copilot_stats cs LIMIT 1),
      'human',   (SELECT row_to_json(hs) FROM human_stats   hs LIMIT 1)
    )
  ) INTO result;

  RETURN result;
END;
$function$;
