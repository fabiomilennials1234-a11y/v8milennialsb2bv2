-- 20271015000000_demolicao_dos_espelhos.sql
-- SCRUM-639 (W6) — demolição final dos espelhos do motor de funis.
--
-- Decisão de cutover (CTO, 2026-09-07): a janela temporal de sete dias foi
-- substituída por um gate técnico reforçado para fechamento do épico no mesmo
-- dia. A decisão não transforma pg_stat_statements em evidência: seus
-- contadores sofrem eviction e não têm last_call nesta versão. A autorização
-- vem do conjunto abaixo, revisado antes do apply:
--   • frontend e 17 Edge Functions da main publicados em produção;
--   • gate AST sobre todo src/ + supabase/functions/ com zero leitor;
--   • 108/108 workflows n8n ativos sem acesso executável aos espelhos;
--   • zero função/procedure SQL e zero view/rule dependente;
--   • paridade linha a linha das seis views contra o modelo canônico:
--     49.203 linhas comparadas, zero divergência;
--   • rollback destrutivo/restaurador ensaiado em transação contra o catálogo
--     vivo, incluindo definitions, ACLs, owners, comments e triggers.
--
-- Remove:
--   • 6 views de compatibilidade;
--   • 18 triggers INSTEAD OF e suas 18 funções;
--   • 8 wrappers RPC legados sem chamadores.
--
-- Mantém, deliberadamente:
--   • pipeline_entries.stage_key — chave operacional ainda viva;
--   • leads.pipe_whatsapp — espelho de coluna tratado pela SCRUM-222;
--   • seis RPCs por slug/type ainda consumidas pelo frontend.
--
-- Rollback pareado:
-- supabase/migrations/rollback/20271015000000_demolicao_dos_espelhos.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- G0 — o catálogo precisa ser exatamente o revisado. Drift aborta fechado.
DO $g0$
DECLARE
  v_views int;
  v_triggers int;
  v_trigger_functions int;
  v_wrappers int;
BEGIN
  SELECT count(*) INTO v_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v'
    AND c.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                      'custom_pipe_entries','custom_pipelines','custom_pipeline_stages');

  SELECT count(*) INTO v_triggers
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
    AND c.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                      'custom_pipe_entries','custom_pipelines','custom_pipeline_stages');

  SELECT count(*) INTO v_trigger_functions
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname ~ '^(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)_(insert|update|delete)_fn$';

  SELECT count(*) INTO v_wrappers
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('delete_custom_pipeline','delete_system_pipeline',
      'custom_pipeline_delete_impact','system_pipeline_delete_impact',
      'get_custom_pipeline_stage_counts','get_custom_filtered_lead_ids',
      'bulk_add_to_custom_pipe','system_stage_role');

  IF (v_views,v_triggers,v_trigger_functions,v_wrappers)
     IS DISTINCT FROM (6,18,18,8) THEN
    RAISE EXCEPTION
      'G0 REPROVOU — catálogo divergiu (views=%, triggers=%, trigger_functions=%, wrappers=%; esperado 6/18/18/8)',
      v_views,v_triggers,v_trigger_functions,v_wrappers;
  END IF;
END
$g0$;

-- G1 — nenhum corpo SQL/plpgsql pode ler ou escrever pelos espelhos.
DO $g1$
DECLARE
  v_offenders text;
BEGIN
  WITH definitions AS (
    SELECT p.proname, regexp_replace(pg_get_functiondef(p.oid), '"', '', 'g') AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.prokind IN ('f','p')
      AND l.lanname IN ('plpgsql','sql')
  ), targets(name) AS (
    SELECT unnest(ARRAY['pipe_whatsapp','pipe_confirmacao','pipe_propostas',
      'custom_pipe_entries','custom_pipelines','custom_pipeline_stages'])
  )
  SELECT string_agg(DISTINCT d.proname || ' → ' || t.name, E'\n    ' ORDER BY d.proname || ' → ' || t.name)
  INTO v_offenders
  FROM definitions d JOIN targets t
    ON d.body ~* ('(from|join)\s+(public\.)?' || t.name || '\M')
    OR d.body ~* ('(insert\s+into|update|delete\s+from)\s+(public\.)?' || t.name || '\M');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION E'G1 REPROVOU — funções/procedures ainda usam espelhos:\n    %', v_offenders;
  END IF;
END
$g1$;

-- G2 — nenhuma view/rule externa pode depender dos espelhos.
DO $g2$
DECLARE v_dependencies text;
BEGIN
  SELECT string_agg(DISTINCT dep.relname || ' depende de ' || target.relname, E'\n    ')
  INTO v_dependencies
  FROM pg_depend d
  JOIN pg_rewrite rw ON rw.oid=d.objid
  JOIN pg_class dep ON dep.oid=rw.ev_class
  JOIN pg_class target ON target.oid=d.refobjid
  JOIN pg_namespace n ON n.oid=target.relnamespace
  WHERE n.nspname='public'
    AND target.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
      'custom_pipe_entries','custom_pipelines','custom_pipeline_stages')
    AND dep.relname<>target.relname;

  IF v_dependencies IS NOT NULL THEN
    RAISE EXCEPTION E'G2 REPROVOU — dependências externas:\n    %', v_dependencies;
  END IF;
END
$g2$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Wrappers de RPC legados — substituídos pelo motor único da unificação
--
--    Cada par abaixo tem sucessor VIVO e zero chamador medido em código:
--      delete_custom_pipeline / delete_system_pipeline   → delete_pipeline(p_pipeline_id)
--      custom_pipeline_delete_impact
--        / system_pipeline_delete_impact                 → pipeline_delete_impact(p_pipeline_id)
--      get_custom_pipeline_stage_counts                  → get_pipeline_stage_counts_by_id(...)
--      get_custom_filtered_lead_ids                      → get_filtered_lead_ids(...) por pipeline_id
--      bulk_add_to_custom_pipe                           → bulk_add_to_pipeline(...)
--      system_stage_role                                 → pipeline_stages.stage_role / metric_stage_role
--
--    NÃO estão aqui, de propósito, porque AINDA TÊM CHAMADOR VIVO no front:
--      get_pipeline_stage_counts(p_pipeline_slug…)  ← usePaginatedPipeline.ts:298
--      get_filtered_lead_ids(p_pipeline_type…)      ← useFilteredLeadIds.ts:99
--      get_stage_lead_ids(p_pipeline_type…)         ← useStageLeadIds.ts:26
--      bulk_move_stage(p_target_pipe…)              ← useBulkActions.ts:18
--      get_funnel_conversion / get_pipeline_velocity / get_sales_cycle_analysis
--                                                   ← useAnalytics.ts (p_pipeline_type)
--    Esses seis assinam por SLUG/TYPE em vez de `pipeline_id`; trocá-los é
--    fatia de front, não deste DROP.
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.delete_custom_pipeline(uuid);
DROP FUNCTION IF EXISTS public.delete_system_pipeline(uuid, text);
DROP FUNCTION IF EXISTS public.custom_pipeline_delete_impact(uuid);
DROP FUNCTION IF EXISTS public.system_pipeline_delete_impact(uuid, text);
DROP FUNCTION IF EXISTS public.get_custom_pipeline_stage_counts(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_custom_filtered_lead_ids(uuid, uuid, text, uuid, uuid[], text[], text[], text[], uuid);
DROP FUNCTION IF EXISTS public.bulk_add_to_custom_pipe(uuid[], uuid, uuid);
DROP FUNCTION IF EXISTS public.system_stage_role(text, text);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. As 6 views. Os 18 triggers INSTEAD OF caem junto (são objetos da view).
--    CASCADE é proibido aqui: se algo ainda depende, G2 já reprovou; um
--    CASCADE que "resolve" é exatamente o que apaga um dependente sem ninguém
--    ver. RESTRICT é o default e é o que queremos.
-- ════════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.pipe_whatsapp RESTRICT;
DROP VIEW IF EXISTS public.pipe_confirmacao RESTRICT;
DROP VIEW IF EXISTS public.pipe_propostas RESTRICT;
DROP VIEW IF EXISTS public.custom_pipe_entries RESTRICT;
DROP VIEW IF EXISTS public.custom_pipeline_stages RESTRICT;
DROP VIEW IF EXISTS public.custom_pipelines RESTRICT;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. As 18 funções de trigger INSTEAD OF — órfãs depois do DROP VIEW.
--    Elas NÃO caem junto com a view; ficariam em `pg_proc` para sempre, e a
--    próxima varredura de "o que sobrou do espelho" as acharia como se fossem
--    código vivo.
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.pipe_whatsapp_insert_fn();
DROP FUNCTION IF EXISTS public.pipe_whatsapp_update_fn();
DROP FUNCTION IF EXISTS public.pipe_whatsapp_delete_fn();
DROP FUNCTION IF EXISTS public.pipe_confirmacao_insert_fn();
DROP FUNCTION IF EXISTS public.pipe_confirmacao_update_fn();
DROP FUNCTION IF EXISTS public.pipe_confirmacao_delete_fn();
DROP FUNCTION IF EXISTS public.pipe_propostas_insert_fn();
DROP FUNCTION IF EXISTS public.pipe_propostas_update_fn();
DROP FUNCTION IF EXISTS public.pipe_propostas_delete_fn();
DROP FUNCTION IF EXISTS public.custom_pipe_entries_insert_fn();
DROP FUNCTION IF EXISTS public.custom_pipe_entries_update_fn();
DROP FUNCTION IF EXISTS public.custom_pipe_entries_delete_fn();
DROP FUNCTION IF EXISTS public.custom_pipeline_stages_insert_fn();
DROP FUNCTION IF EXISTS public.custom_pipeline_stages_update_fn();
DROP FUNCTION IF EXISTS public.custom_pipeline_stages_delete_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_insert_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_update_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_delete_fn();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Asserção final — espelhos = 0. É o critério D5 do épico, escrito como
--    predicado, não como parágrafo.
-- ════════════════════════════════════════════════════════════════════════════
DO $fim$
DECLARE
  v_views int;
  v_trgfn int;
  v_wrappers int;
BEGIN
  SELECT count(*) INTO v_views
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                       'custom_pipe_entries','custom_pipelines','custom_pipeline_stages');

  SELECT count(*) INTO v_trgfn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname ~ '^(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)_(insert|update|delete)_fn$';

  SELECT count(*) INTO v_wrappers
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('delete_custom_pipeline','delete_system_pipeline',
       'custom_pipeline_delete_impact','system_pipeline_delete_impact',
       'get_custom_pipeline_stage_counts','get_custom_filtered_lead_ids',
       'bulk_add_to_custom_pipe','system_stage_role');

  IF v_views <> 0 OR v_trgfn <> 0 OR v_wrappers <> 0 THEN
    RAISE EXCEPTION 'Demolição incompleta: views=%, funções de trigger=%, wrappers=%.', v_views, v_trgfn, v_wrappers;
  END IF;

  RAISE NOTICE 'Espelhos = 0. Funil é Funil entregue (SCRUM-639/D5).';
END
$fim$;

NOTIFY pgrst, 'reload schema';
COMMIT;
