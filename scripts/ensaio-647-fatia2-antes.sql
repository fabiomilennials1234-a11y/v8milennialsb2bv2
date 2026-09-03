-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-647 FATIA 2 — ANTES
-- Abre a transacao e captura o BASELINE das 16 funcoes que a fatia reescreve,
-- por org real, com o contexto de autenticacao de um usuario real de cada org.
--
-- Payload montado por scripts/ensaio-647-fatia2.sh:
--   ensaio-647-fatia2-antes.sql   (BEGIN + captura 'antes')
--     -> supabase/migrations/20270919000020_leitoras_pela_projecao_canonica.sql
--     -> supabase/migrations/20270919000030_dashboard_metrics_pela_projecao.sql
--     -> ensaio-647-fatia2-depois.sql (captura 'depois' + provas + ENSAIO_OK)
--   -> ROLLBACK. NADA e aplicado.
--
-- Autorizacao vigente do CTO para ensaio que aborta sozinho.
--
-- ─── O QUE ESTE ENSAIO PROVA, E O QUE ELE NAO PROVA ────────────────────────
--
-- PROVA A (antes x depois, por org): as 10 funcoes chamaveis diretamente sao
--   executadas nas DUAS fases, na MESMA transacao, com os MESMOS argumentos, e
--   o md5 do conjunto tem de bater. Divergencia = EXCEPTION, nunca arredonda.
--
-- PROVA B (identidade de relacao, global — as 108 orgs, nao so as 3): as 6 views de
--   compat e as relacoes que as substituem sao comparadas por DIFERENCA
--   SIMETRICA (`EXCEPT ALL` nos dois sentidos) sobre o conjunto COMPLETO de
--   colunas da viewdef. Zero linhas de diferenca prova que a troca preserva o
--   numero para QUALQUER leitora — inclusive as 6 que nao sao chamaveis direto
--   (2 gatilhos, 2 funcoes que apagam, 2 que criam lead). Para essas 6, a
--   PROVA A nao existe e seria desonesto fingir que existe: o que as cobre e a
--   PROVA B mais as provas de fragmento B7-B9, que exercitam o predicado exato
--   que o corpo delas usa, sobre os dados reais.
--
-- LIMITE DECLARADO: a Management API executa como `postgres`, que BYPASSA RLS.
--   Isso NAO invalida a comparacao — as duas fases rodam sob o mesmo papel, e
--   o que se compara e um numero contra o outro. Mas nao e uma prova de RLS;
--   nenhuma linha desta fatia altera policy, grant de tabela ou o
--   `security_invoker` de view nenhuma. A P11 mede os grants de EXECUTE das 16
--   nas duas fases exatamente porque "CREATE OR REPLACE nao mexe em grant" e
--   afirmacao, e afirmacao nao e medicao.
--
-- CONTROLE POSITIVO: toda prova guarda a CARDINALIDADE junto com o md5, e a
--   fase final REPROVA se qualquer prova tiver cardinalidade zero. Dois hashes
--   iguais de dois conjuntos vazios nao provam nada — e a forma mais comum de
--   falso verde neste repo.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _e647 (
  fase  text,
  org   text,
  prova text,
  valor text,
  n     bigint
) ON COMMIT DROP;
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
SELECT pg_temp._e647_org('antes', 'Milennials', '6030520a-2ca7-477d-be89-55758e2cd808', '23a14cad-7859-4f92-83e5-6139909a2c39');
SELECT pg_temp._e647_org('antes', 'Basic4u',    '163874dd-d05c-4ae2-811a-d6772b05dac5', 'fc4bc71c-de3f-4ec3-b563-4b7283409a18');
SELECT pg_temp._e647_org('antes', 'Chique',     '38f3bea4-44c6-4732-bb20-065f547a7ed8', '46c1b874-7492-4378-b609-fbb309ba1e87');

-- P05 so em Milennials: get_analytics_engagement_metrics custa ~25-30s por org
-- (o bloco de 6 meses roda independente da janela pedida), e 3 orgs x 2 fases
-- estouraria o teto de ~120s do gateway. As outras duas orgs desta funcao sao
-- cobertas pela PROVA B3 + o fragmento B10, que exercita os DOIS sitios que
-- esta fatia alterou dentro dela, nas 3 orgs.
SELECT pg_temp._e647_engajamento('antes', 'Milennials', '6030520a-2ca7-477d-be89-55758e2cd808', '23a14cad-7859-4f92-83e5-6139909a2c39');

SELECT pg_temp._e647_grants('antes');
