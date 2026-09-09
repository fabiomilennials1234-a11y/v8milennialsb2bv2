-- =========================================================================
-- ENSAIO SCRUM-647 FATIA 2 — DEPOIS
-- Recaptura as MESMAS sondas com a fatia aplicada (dentro da transacao), roda
-- as provas de identidade de relacao e de fragmento, mede quantas leitoras
-- restam, e ABORTA com ENSAIO_OK. Nada e aplicado.
-- =========================================================================

-- ─── AS SONDAS ─────────────────────────────────────────────────────────────
-- As sondas vivem em funcoes TEMPORARIAS, e nao em dois blocos DO copiados.
-- Duas razoes, as duas medidas:
--
--   1. UM TEXTO SO. Escrever a captura duas vezes e a forma mais facil de
--      provar igualdade por simetria de digitacao em vez de por dados.
--
--   2. PLANO NOVO A CADA FASE. `CREATE OR REPLACE` reescreve a tupla de
--      pg_proc da sonda, e o plpgsql recompila a funcao quando a tupla muda —
--      entao a fase 'depois' NAO pode reusar um plano em cache que ainda
--      trouxesse o corpo antigo das funcoes migradas (funcao SQL STABLE, como
--      lead_excluded_from_metrics, e INLINADA no plano). Por isso o CREATE OR
--      REPLACE aparece nos DOIS arquivos, identico, e nao so no 'antes'.
--
--   3. UM STATEMENT POR ORG. A Management API morre num 524 do Cloudflare em
--      ~120s: o payload INTEIRO tem esse orcamento. Uma sonda por org mantem
--      cada statement curto e o total sob o teto.

-- ─── AS SONDAS ─────────────────────────────────────────────────────────────
-- As sondas vivem em funcoes TEMPORARIAS, e nao em dois blocos DO copiados.
-- Duas razoes, as duas medidas:
--
--   1. UM TEXTO SO. Escrever a captura duas vezes e a forma mais facil de
--      provar igualdade por simetria de digitacao em vez de por dados.
--
--   2. PLANO NOVO A CADA FASE. `CREATE OR REPLACE` reescreve a tupla de
--      pg_proc da sonda, e o plpgsql recompila a funcao quando a tupla muda —
--      entao a fase 'depois' NAO pode reusar um plano em cache que ainda
--      trouxesse o corpo antigo das funcoes migradas (funcao SQL STABLE, como
--      lead_excluded_from_metrics, e INLINADA no plano). Por isso o CREATE OR
--      REPLACE aparece nos DOIS arquivos, identico, e nao so no 'antes'.
--
--   3. UM STATEMENT POR ORG. A Management API morre num 524 do Cloudflare em
--      ~120s: o payload INTEIRO tem esse orcamento. Uma sonda por org mantem
--      cada statement curto e o total sob o teto.

CREATE OR REPLACE FUNCTION pg_temp._e647_org(
  p_fase text, p_nome text, p_org uuid, p_usr uuid
) RETURNS void LANGUAGE plpgsql AS $sonda$
DECLARE
  v_md5 text;
  v_n   bigint;
  v_ini timestamptz := now() - interval '365 days';
  v_fim timestamptz := now() + interval '365 days';
BEGIN
    -- auth.uid() le este GUC. Sem ele, assert_org_access / resolve_org_for_rpc /
    -- get_my_organization_ids devolvem vazio e a prova ficaria verde por NAO
    -- TER RODADO. `true` = LOCAL: morre com a transacao.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);

    -- P01 — get_agenda_events (Source 4 le pipe_confirmacao)
    SELECT md5(COALESCE(string_agg(x, '|' ORDER BY x), '<vazio>')), count(*) INTO v_md5, v_n
      FROM (SELECT e::text AS x FROM public.get_agenda_events(p_org, v_ini, v_fim) e) s;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P01 get_agenda_events', v_md5, v_n);

    -- P02 — get_agenda_events_scoped (le pipe_confirmacao no recorte por dono)
    SELECT md5(COALESCE(string_agg(x, '|' ORDER BY x), '<vazio>')), count(*) INTO v_md5, v_n
      FROM (SELECT e::text AS x FROM public.get_agenda_events_scoped(p_org, v_ini, v_fim) e) s;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P02 get_agenda_events_scoped', v_md5, v_n);

    -- P03 — get_all_funnels_lead_ids (os DOIS ramos: system e custom)
    SELECT md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '<vazio>')), count(*) INTO v_md5, v_n
      FROM public.get_all_funnels_lead_ids(NULL, NULL, NULL, NULL, p_org) x;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P03 get_all_funnels_lead_ids', v_md5, v_n);

    -- P04 — get_product_ranking (le pipe_propostas + deal_id)
    SELECT md5(COALESCE(x::text, '<null>')), COALESCE(jsonb_array_length(x), -1) INTO v_md5, v_n
      FROM public.get_product_ranking(p_org, v_ini, now()) x;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P04 get_product_ranking', v_md5, v_n);

    -- P06 — get_dashboard_metrics (arquivo 20270919000030)
    SELECT md5(COALESCE(x::text, '<null>')), COALESCE(jsonb_array_length(jsonb_path_query_array(x, '$.*')), -1)
      INTO v_md5, v_n
      FROM public.get_dashboard_metrics(p_org, v_ini, now(), NULL) x;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P06 get_dashboard_metrics', v_md5, v_n);

    -- P07 — lead_excluded_from_metrics, lead a lead, TODOS os leads da org
    SELECT md5(COALESCE(string_agg(l.id::text || ':' ||
             public.lead_excluded_from_metrics(l.id, p_org)::text, '|' ORDER BY l.id), '<vazio>')),
           count(*)
      INTO v_md5, v_n
      FROM public.leads l WHERE l.organization_id = p_org;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P07 lead_excluded_from_metrics', v_md5, v_n);

    -- P08/P09/P10 — os 3 utilitarios de etapa, sobre TODO par (funil, etapa)
    -- que a org tem: os de pipeline_stages MAIS os que so existem em entrada.
    SELECT md5(COALESCE(string_agg(
             pr.pipeline_id::text || '/' || pr.stage_key || ':' ||
             COALESCE(public.metric_stage_role(p_org, pr.pipeline_id, pr.stage_key)::text, '<null>'),
             '|' ORDER BY pr.pipeline_id, pr.stage_key), '<vazio>')), count(*)
      INTO v_md5, v_n
      FROM (
        SELECT DISTINCT pe.pipeline_id, pe.stage_key FROM public.pipeline_entries pe
         WHERE pe.organization_id = p_org AND pe.stage_key IS NOT NULL
        UNION
        SELECT DISTINCT ps.pipeline_id, ps.stage_key FROM public.pipeline_stages ps
         WHERE ps.organization_id = p_org AND ps.pipeline_id IS NOT NULL AND ps.stage_key IS NOT NULL
      ) pr;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P08 metric_stage_role', v_md5, v_n);

    SELECT md5(COALESCE(string_agg(
             pr.pipeline_id::text || '/' || pr.stage_key || ':' ||
             COALESCE(public._stage_is_final(p_org, pr.pipeline_id, pr.stage_key)::text, '<null>'),
             '|' ORDER BY pr.pipeline_id, pr.stage_key), '<vazio>')), count(*)
      INTO v_md5, v_n
      FROM (
        SELECT DISTINCT pe.pipeline_id, pe.stage_key FROM public.pipeline_entries pe
         WHERE pe.organization_id = p_org AND pe.stage_key IS NOT NULL
        UNION
        SELECT DISTINCT ps.pipeline_id, ps.stage_key FROM public.pipeline_stages ps
         WHERE ps.organization_id = p_org AND ps.pipeline_id IS NOT NULL AND ps.stage_key IS NOT NULL
      ) pr;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P09 _stage_is_final', v_md5, v_n);

    SELECT md5(COALESCE(string_agg(
             pr.pipeline_id::text || '/' || pr.stage_key || ':' ||
             COALESCE(public._stage_key_label(p_org, pr.pipeline_id, pr.stage_key), '<null>'),
             '|' ORDER BY pr.pipeline_id, pr.stage_key), '<vazio>')), count(*)
      INTO v_md5, v_n
      FROM (
        SELECT DISTINCT pe.pipeline_id, pe.stage_key FROM public.pipeline_entries pe
         WHERE pe.organization_id = p_org AND pe.stage_key IS NOT NULL
        UNION
        SELECT DISTINCT ps.pipeline_id, ps.stage_key FROM public.pipeline_stages ps
         WHERE ps.organization_id = p_org AND ps.pipeline_id IS NOT NULL AND ps.stage_key IS NOT NULL
      ) pr;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P10 _stage_key_label', v_md5, v_n);
END
$sonda$;

CREATE OR REPLACE FUNCTION pg_temp._e647_engajamento(
  p_fase text, p_nome text, p_org uuid, p_usr uuid
) RETURNS void LANGUAGE plpgsql AS $sonda$
DECLARE
  v_md5 text;
  v_n   bigint;
  -- 90 dias, e nao 365 como nas outras sondas: medido em prod, esta funcao leva
  -- ~25s por org em 90 dias e ESTOURA os 120s do gateway em 365. A janela nao
  -- enfraquece a prova dos dois sitios alterados: `monthly_closed` roda sempre
  -- sobre os ULTIMOS 6 MESES, independente de p_start_date, e `period_proposals`
  -- cobre 90 dias de propostas reais. O que a janela nao alcanca esta em B10.
  v_ini timestamptz := now() - interval '90 days';
BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
    -- P05 — get_analytics_engagement_metrics (2 sitios: close_rate e monthly_closed)
    SELECT md5(COALESCE(x::text, '<null>')), COALESCE(jsonb_array_length(jsonb_path_query_array(x, '$.*')), -1)
      INTO v_md5, v_n
      FROM public.get_analytics_engagement_metrics(p_org, v_ini::date, now()::date, NULL, NULL) x;
    INSERT INTO _e647 VALUES (p_fase, p_nome, 'P05 get_analytics_engagement_metrics', v_md5, v_n);
END
$sonda$;

CREATE OR REPLACE FUNCTION pg_temp._e647_grants(p_fase text)
RETURNS void LANGUAGE plpgsql AS $sonda$
DECLARE
  v_md5 text;
  v_n   bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  -- P11 — GRANTS das 16. CREATE OR REPLACE nao mexe em grant, mas "nao mexe" e
  -- afirmacao; isto e medicao. Se um DROP escapar, EXECUTE volta para PUBLIC.
  SELECT md5(string_agg(x, '|' ORDER BY x)), count(*) INTO v_md5, v_n FROM (
    SELECT p.proname || '/' || g.papel || '=' ||
           has_function_privilege(g.papel, p.oid, 'EXECUTE')::text AS x
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS g(papel)
    WHERE p.proname = ANY (ARRAY[
      '_stage_is_final','_stage_key_label','metric_stage_role',
      'fn_log_pipeline_stage_change_history','lead_excluded_from_metrics',
      'purge_lead','delete_pipeline','create_lead_from_social_conversation',
      'fn_auto_assign_lead_default_pipe','import_lead_into_custom_pipeline',
      'get_agenda_events','get_agenda_events_scoped','get_all_funnels_lead_ids',
      'get_product_ranking','get_analytics_engagement_metrics','get_dashboard_metrics'])
  ) s;
  INSERT INTO _e647 VALUES (p_fase, '(global)', 'P11 grants EXECUTE das 16', v_md5, v_n);
END
$sonda$;

-- ─── AS CHAMADAS ───────────────────────────────────────────────────────────
-- 3 orgs reais com volume, cada uma com um usuario ADMIN ATIVO real dela.
-- Milennials 2.939 entradas / Basic4u 4.315 / Chique Distribuidora 4.294
-- (medido em prod 2026-09-03; Chique e a de maior proporcao custom: 4.048).
SELECT pg_temp._e647_org('depois', 'Milennials', '6030520a-2ca7-477d-be89-55758e2cd808', '23a14cad-7859-4f92-83e5-6139909a2c39');
SELECT pg_temp._e647_org('depois', 'Basic4u',    '163874dd-d05c-4ae2-811a-d6772b05dac5', 'fc4bc71c-de3f-4ec3-b563-4b7283409a18');
SELECT pg_temp._e647_org('depois', 'Chique',     '38f3bea4-44c6-4732-bb20-065f547a7ed8', '46c1b874-7492-4378-b609-fbb309ba1e87');

-- P05 so em Milennials: get_analytics_engagement_metrics custa ~25-30s por org
-- (o bloco de 6 meses roda independente da janela pedida), e 3 orgs x 2 fases
-- estouraria o teto de ~120s do gateway. As outras duas orgs desta funcao sao
-- cobertas pela PROVA B3 + o fragmento B10, que exercita os DOIS sitios que
-- esta fatia alterou dentro dela, nas 3 orgs.
SELECT pg_temp._e647_engajamento('depois', 'Milennials', '6030520a-2ca7-477d-be89-55758e2cd808', '23a14cad-7859-4f92-83e5-6139909a2c39');

SELECT pg_temp._e647_grants('depois');

-- ═══════════════════════════════════════════════════════════════════════════
-- PROVA B — IDENTIDADE DE RELACAO, global (todas as orgs), diferenca simetrica
--
-- `EXCEPT ALL` nos dois sentidos: 0 linhas prova que as duas relacoes tem as
-- MESMAS linhas com a MESMA multiplicidade, sobre o conjunto COMPLETO de
-- colunas da viewdef de prod. E o alicerce das 6 funcoes que a PROVA A nao
-- alcanca (2 gatilhos, purge_lead, delete_pipeline, e as 2 que criam lead).
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO _e647
WITH v AS (
  SELECT id, lead_id, organization_id, status, responsible_id, sdr_id,
         pre_sale_responsible_id, sale_responsible_id, scheduled_date, notes,
         created_at, updated_at
    FROM public.pipe_whatsapp
), n AS (
  SELECT id, lead_id, organization_id, stage_key, responsible_id, sdr_id,
         pre_sale_responsible_id, sale_responsible_id, scheduled_date, notes,
         created_at, updated_at
    FROM public.negocio_projetado WHERE funil_sistema = 'whatsapp'
)
SELECT 'prova-b', '(global)', 'B1 pipe_whatsapp = projecao[whatsapp]',
       (SELECT count(*)::text FROM ((TABLE v EXCEPT ALL TABLE n) UNION ALL (TABLE n EXCEPT ALL TABLE v)) d),
       (SELECT count(*) FROM v);

INSERT INTO _e647
WITH v AS (
  SELECT id, lead_id, organization_id, status, meeting_date, is_confirmed,
         closer_id, responsible_id, sdr_id, pre_sale_responsible_id,
         sale_responsible_id, meet_link, notes, metrics_period_at,
         created_at, updated_at
    FROM public.pipe_confirmacao
), n AS (
  SELECT id, lead_id, organization_id, stage_key, meeting_date, is_confirmed,
         closer_id, responsible_id, sdr_id, pre_sale_responsible_id,
         sale_responsible_id, meet_link, notes, metrics_period_at,
         created_at, updated_at
    FROM public.negocio_projetado WHERE funil_sistema = 'confirmacao'
)
SELECT 'prova-b', '(global)', 'B2 pipe_confirmacao = projecao[confirmacao]',
       (SELECT count(*)::text FROM ((TABLE v EXCEPT ALL TABLE n) UNION ALL (TABLE n EXCEPT ALL TABLE v)) d),
       (SELECT count(*) FROM v);

INSERT INTO _e647
WITH v AS (
  SELECT id, lead_id, organization_id, status, sale_value, closer_id,
         responsible_id, pre_sale_responsible_id, sale_responsible_id,
         product_id, product_type, calor, loss_reason, loss_reason_id,
         commitment_date, contract_duration, notes, metrics_period_at,
         closed_at, created_at, updated_at
    FROM public.pipe_propostas
), n AS (
  SELECT id, lead_id, organization_id, stage_key, sale_value, closer_id,
         responsible_id, pre_sale_responsible_id, sale_responsible_id,
         product_id, product_type, calor, loss_reason, loss_reason_id,
         commitment_date, contract_duration, notes, metrics_period_at,
         closed_at, created_at, updated_at
    FROM public.negocio_projetado WHERE funil_sistema = 'propostas'
)
SELECT 'prova-b', '(global)', 'B3 pipe_propostas = projecao[propostas]',
       (SELECT count(*)::text FROM ((TABLE v EXCEPT ALL TABLE n) UNION ALL (TABLE n EXCEPT ALL TABLE v)) d),
       (SELECT count(*) FROM v);

INSERT INTO _e647
WITH v AS (
  SELECT id, organization_id, pipeline_id, lead_id, stage_id, assigned_to,
         notes, entered_at, stage_changed_at, created_at, updated_at,
         pre_sale_responsible_id, sale_responsible_id, deal_id
    FROM public.custom_pipe_entries
), n AS (
  SELECT id, organization_id, pipeline_id, lead_id, stage_id, assigned_to,
         notes, entered_at, stage_changed_at, created_at, updated_at,
         pre_sale_responsible_id, sale_responsible_id, deal_id
    FROM public.negocio_projetado WHERE pipeline_type = 'custom'
)
SELECT 'prova-b', '(global)', 'B4 custom_pipe_entries = projecao[custom]',
       (SELECT count(*)::text FROM ((TABLE v EXCEPT ALL TABLE n) UNION ALL (TABLE n EXCEPT ALL TABLE v)) d),
       (SELECT count(*) FROM v);

-- B5 — custom_pipelines nao e relacao de ENTRADA: nao ha dinheiro nela e a
-- projecao nao a cobre. Ela e `pipelines` filtrada por funil custom, e as
-- colunas que as leitoras desta fatia usam (id, organization_id, slug,
-- is_active) vem da tabela sem transformacao nenhuma.
INSERT INTO _e647
WITH v AS (
  SELECT id, organization_id, name, slug, description, icon, color, is_active,
         created_by, created_at, updated_at
    FROM public.custom_pipelines
), n AS (
  SELECT id, organization_id, name, slug, description, icon, color, is_active,
         created_by, created_at, updated_at
    FROM public.pipelines WHERE type = 'custom'
)
SELECT 'prova-b', '(global)', 'B5 custom_pipelines = pipelines[custom]',
       (SELECT count(*)::text FROM ((TABLE v EXCEPT ALL TABLE n) UNION ALL (TABLE n EXCEPT ALL TABLE v)) d),
       (SELECT count(*) FROM v);

INSERT INTO _e647
WITH v AS (
  SELECT id, organization_id, pipeline_id, stage_key, name, color, "position",
         is_active, is_final_positive, is_final_negative, target_pipeline_id,
         target_stage_id, target_pipe_type, target_stage_key, created_at,
         updated_at, checklist_template_id, stage_role, suggested_stage_role,
         stage_role_suggested_at, stage_role_suggestion_source,
         stage_role_reviewed_at, stage_role_reviewed_by, requires_sale_value
    FROM public.custom_pipeline_stages
), n AS (
  SELECT ps.id, ps.organization_id, ps.pipeline_id, ps.stage_key, ps.name,
         ps.color, ps."position", ps.is_active, ps.is_final_positive,
         ps.is_final_negative, ps.target_pipeline_id, ps.target_stage_id,
         ps.target_pipe_type, ps.target_stage_key, ps.created_at, ps.updated_at,
         ps.checklist_template_id, ps.stage_role, ps.suggested_stage_role,
         ps.stage_role_suggested_at, ps.stage_role_suggestion_source,
         ps.stage_role_reviewed_at, ps.stage_role_reviewed_by,
         ps.requires_sale_value
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
)
SELECT 'prova-b', '(global)', 'B6 custom_pipeline_stages = stages[custom]',
       (SELECT count(*)::text FROM ((TABLE v EXCEPT ALL TABLE n) UNION ALL (TABLE n EXCEPT ALL TABLE v)) d),
       (SELECT count(*) FROM v);

-- ─── B7-B9: os fragmentos EXATOS das funcoes que a PROVA A nao alcanca ──────

-- B7 — fn_auto_assign_lead_default_pipe: o guarda "ja esta em funil custom?",
-- lead a lead, sobre TODOS os leads de TODAS as orgs.
INSERT INTO _e647
SELECT 'prova-b', '(global)', 'B7 fn_auto_assign: EXISTS custom por lead',
       count(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM public.custom_pipe_entries c WHERE c.lead_id = l.id)
           IS DISTINCT FROM
               EXISTS (SELECT 1 FROM public.negocio_projetado c
                        WHERE c.pipeline_type = 'custom' AND c.lead_id = l.id)
       )::text,
       count(*)
  FROM public.leads l;

-- B8 — fn_log_pipeline_stage_change_history e metric_stage_role: o nome/papel
-- da etapa resolvido pelo ramo custom. Compara o CONJUNTO de nomes, nao um
-- LIMIT 1 sem ORDER BY (que poderia bater por sorte).
INSERT INTO _e647
SELECT 'prova-b', '(global)', 'B8 lookup de etapa no ramo custom',
       count(*) FILTER (
         WHERE (SELECT string_agg(c.name, '|' ORDER BY c.name)
                  FROM public.custom_pipeline_stages c
                 WHERE c.pipeline_id = q.pipeline_id AND c.stage_key = q.stage_key)
           IS DISTINCT FROM
               (SELECT string_agg(s.name, '|' ORDER BY s.name)
                  FROM public.pipeline_stages s
                 WHERE s.pipeline_id = q.pipeline_id AND s.stage_key = q.stage_key)
       )::text,
       count(*)
  FROM (
    SELECT DISTINCT pe.pipeline_id, pe.stage_key
      FROM public.pipeline_entries pe
      JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
     WHERE pe.stage_key IS NOT NULL
  ) q;

-- B9 — create_lead_from_social_conversation e import_lead_into_custom_pipeline:
-- o guarda de etapa perdeu o predicado de funil custom porque o guarda ANTERIOR
-- ja provou que o funil e custom. Isto mede a afirmacao: dentro de um funil
-- custom, existe alguma linha de `pipeline_stages` que `custom_pipeline_stages`
-- NAO tem? Se existir, largar o predicado abriria o guarda. Tem de ser 0.
INSERT INTO _e647
SELECT 'prova-b', '(global)', 'B9 stages a mais dentro de funil custom',
       (SELECT count(*) FROM public.pipeline_stages ps
          JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
         WHERE NOT EXISTS (SELECT 1 FROM public.custom_pipeline_stages c WHERE c.id = ps.id))::text,
       (SELECT count(*) FROM public.pipeline_stages ps
          JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom');

-- B10 — get_analytics_engagement_metrics: os DOIS sitios que a fatia alterou
-- dentro dela, nas 3 orgs. A PROVA A so cobre Milennials (custo de tempo); este
-- fragmento cobre as outras duas exercitando o predicado exato do corpo novo.
--   sitio 1 (period_proposals): (lead_id, status) por org
--   sitio 2 (monthly_closed)  : (mes, lead_id) das vendas com closed_at
INSERT INTO _e647
WITH orgs AS (
  SELECT unnest(ARRAY['6030520a-2ca7-477d-be89-55758e2cd808',
                      '163874dd-d05c-4ae2-811a-d6772b05dac5',
                      '38f3bea4-44c6-4732-bb20-065f547a7ed8']::uuid[]) AS org
), v1 AS (
  SELECT pp.lead_id, pp.status, o.org
    FROM public.pipe_propostas pp JOIN orgs o ON o.org = pp.organization_id
), n1 AS (
  SELECT pp.lead_id, pp.stage_key, o.org
    FROM public.negocio_projetado pp JOIN orgs o ON o.org = pp.organization_id
   WHERE pp.funil_sistema = 'propostas'
), v2 AS (
  SELECT date_trunc('month', pp.closed_at) AS m, pp.lead_id, o.org
    FROM public.pipe_propostas pp JOIN orgs o ON o.org = pp.organization_id
   WHERE pp.status = 'vendido' AND pp.closed_at IS NOT NULL
), n2 AS (
  SELECT date_trunc('month', pp.closed_at) AS m, pp.lead_id, o.org
    FROM public.negocio_projetado pp JOIN orgs o ON o.org = pp.organization_id
   WHERE pp.funil_sistema = 'propostas' AND pp.stage_key = 'vendido'
     AND pp.closed_at IS NOT NULL
)
SELECT 'prova-b', '(3 orgs)', 'B10 engagement: period_proposals + monthly_closed',
       ( (SELECT count(*) FROM ((TABLE v1 EXCEPT ALL TABLE n1) UNION ALL (TABLE n1 EXCEPT ALL TABLE v1)) d1)
       + (SELECT count(*) FROM ((TABLE v2 EXCEPT ALL TABLE n2) UNION ALL (TABLE n2 EXCEPT ALL TABLE v2)) d2)
       )::text,
       (SELECT count(*) FROM v1) + (SELECT count(*) FROM v2);

-- ─── MEDICAO FINAL: quantas leitoras de view de compat RESTAM ──────────────
-- `DELETE FROM <view>` casa com o mesmo grep de `FROM <view>` — foi assim que a
-- varredura de partida contou 29. Aqui a escrita e NEUTRALIZADA antes do grep,
-- senao purge_lead, bulk_delete_leads e remove_demo_data seguiriam contadas
-- como leitoras depois de ja terem perdido a leitura.
INSERT INTO _e647
SELECT 'medida', '(global)', 'leitoras de view em FROM/JOIN',
       (SELECT count(*)::text FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
         WHERE p.prokind = 'f'
           AND regexp_replace(pg_get_functiondef(p.oid), 'delete\s+from', 'DELETE_ESCRITA ', 'gi')
               ~* '(from|join)\s+(public\.)?(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)\M'),
       (SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
         WHERE p.prokind = 'f');

INSERT INTO _e647
SELECT 'medida', '(global)', 'escritoras (DELETE/INSERT/UPDATE em view)',
       (SELECT count(*)::text FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
         WHERE p.prokind = 'f'
           AND pg_get_functiondef(p.oid) ~* '(delete\s+from|insert\s+into|update)\s+(public\.)?(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)\M'),
       0;

-- ═══════════════════════════════════════════════════════════════════════════
-- VEREDITO
-- ═══════════════════════════════════════════════════════════════════════════
DO $veredito$
DECLARE
  v_div      text;
  v_vazias   text;
  v_zeros_org text;
  v_por_org  text;
  v_b_det    text;
  v_b        text;
  v_leitoras bigint;
  v_escrit   bigint;
  v_provas   bigint;
  v_linhas   bigint;
BEGIN
  -- (1) toda prova A tem de existir nas DUAS fases e bater md5 E cardinalidade.
  SELECT string_agg(format('%s/%s: antes=%s(n=%s) depois=%s(n=%s)',
           a.org, a.prova, a.valor, a.n, d.valor, d.n), E'\n  ')
    INTO v_div
    FROM _e647 a
    FULL JOIN _e647 d ON d.fase = 'depois' AND d.org = a.org AND d.prova = a.prova
   WHERE a.fase = 'antes'
     AND (d.valor IS NULL OR a.valor IS DISTINCT FROM d.valor OR a.n IS DISTINCT FROM d.n);
  IF v_div IS NOT NULL THEN
    RAISE EXCEPTION E'ENSAIO_DIVERGIU — a fatia MUDOU numero:\n  %', v_div;
  END IF;

  -- (2) CONTROLE POSITIVO. Dois hashes iguais de dois conjuntos VAZIOS nao
  -- provam nada — e o falso verde mais comum neste repo. A regra e por PROVA,
  -- nao por (prova, org): uma org sem nenhuma venda de produto no periodo faz
  -- get_product_ranking devolver `[]` legitimamente, e isso nao invalida a
  -- prova se OUTRA org exercitou a mesma funcao com dados. O que REPROVA e uma
  -- prova que ficou vazia em TODAS as orgs: essa nao rodou em lugar nenhum.
  SELECT string_agg(prova, ', ') INTO v_vazias FROM (
    SELECT prova FROM _e647 WHERE fase = 'antes' GROUP BY prova HAVING max(n) = 0
  ) z;
  IF v_vazias IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO_VAZIO — prova sem linha nenhuma em NENHUMA org (verde por nao ter rodado): %', v_vazias;
  END IF;

  -- E os zeros que sobram vao NOMEADOS para o relatorio: uma prova que so vale
  -- em 2 das 3 orgs tem de dizer isso, nao esconder atras de um OK.
  SELECT string_agg(format('%s/%s', org, prova), ', ' ORDER BY org, prova)
    INTO v_zeros_org
    FROM _e647 WHERE fase = 'antes' AND n = 0;

  -- (3) PROVA B: toda diferenca simetrica tem de ser 0, e todo universo > 0.
  SELECT string_agg(format('%s: diff=%s universo=%s', prova, valor, n), E'\n  ')
    INTO v_b
    FROM _e647 WHERE fase = 'prova-b' AND (valor <> '0' OR n = 0);
  IF v_b IS NOT NULL THEN
    RAISE EXCEPTION E'ENSAIO_DIVERGIU — relacao substituta NAO e identica:\n  %', v_b;
  END IF;

  SELECT count(*), sum(n) INTO v_provas, v_linhas
    FROM _e647 WHERE fase = 'antes';

  -- Numeros POR ORG, nomeados. Um agregado global esconde a org que nao rodou.
  SELECT string_agg(x, E'\n             ' ORDER BY x) INTO v_por_org FROM (
    SELECT format('%-11s %s provas, %s linhas', org, count(*), sum(n)) AS x
      FROM _e647 WHERE fase = 'antes' GROUP BY org
  ) s;
  SELECT string_agg(format('%s=%s/%s', split_part(prova,' ',1), valor, n), ' ' ORDER BY prova)
    INTO v_b_det FROM _e647 WHERE fase = 'prova-b';
  SELECT valor::bigint INTO v_leitoras FROM _e647 WHERE prova = 'leitoras de view em FROM/JOIN';
  SELECT valor::bigint INTO v_escrit   FROM _e647 WHERE prova LIKE 'escritoras%';

  RAISE EXCEPTION E'ENSAIO_OK SCRUM-647-FATIA2\n'
    '  PROVA A  : % provas x 2 fases, md5 E cardinalidade IDENTICOS; % linhas conferidas\n'
    '             %\n'
    '  PROVA B  : diferenca/universo por prova (diferenca tem de ser 0 em todas)\n'
    '             %\n'
    '  GRANTS   : EXECUTE das 16 funcoes identico antes/depois (P11)\n'
    '  LEITORAS : % funcoes de public ainda leem view de compat (era 27 pelo MESMO\n'
    '             criterio; a varredura crua contava 29 porque DELETE FROM <view>\n'
    '             casa com o mesmo grep de FROM <view>)\n'
    '  ESCRITAS : % funcoes ainda ESCREVEM por INSTEAD OF (fora do escopo: SCRUM-639)\n'
    '  ZEROS    : provas sem dado NAQUELA org (cobertas por outra org): %\n'
    '  Nada foi aplicado. ROLLBACK a seguir.',
    v_provas, v_linhas, v_por_org, v_b_det, v_leitoras, v_escrit,
    COALESCE(v_zeros_org, 'nenhum');
END
$veredito$;

ROLLBACK;
