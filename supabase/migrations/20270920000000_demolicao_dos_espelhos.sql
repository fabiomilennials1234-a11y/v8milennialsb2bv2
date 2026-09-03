-- 20270920000000_demolicao_dos_espelhos.sql
-- SCRUM-639 (W6) — o critério de "entregue" do épico Funil é Funil: espelhos = 0.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ ESTE ARQUIVO NÃO PODE SER APLICADO HOJE (2026-09-03).                     │
-- │ A medição em prod nesta data mostra os 6 espelhos QUENTES: em uma janela  │
-- │ de 4 minutos, 5 das 6 views receberam leitura do front (role              │
-- │ `authenticated`), e 32 funções SQL VIVAS em prod ainda leem/escrevem      │
-- │ através delas. O arquivo existe para ser aplicado DEPOIS que a janela de  │
-- │ 7 dias fechar em zero — e as guardas abaixo REPROVAM sozinhas se não.     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- O QUE ESTE ARQUIVO DERRUBA
--   • 6 views de compat: pipe_whatsapp, pipe_confirmacao, pipe_propostas,
--     custom_pipe_entries, custom_pipelines, custom_pipeline_stages.
--   • 18 triggers INSTEAD OF (caem junto com a view) + as 18 funções de
--     trigger, que NÃO caem junto e ficariam órfãs.
--   • 8 wrappers de RPC legados que a unificação substituiu e que hoje não têm
--     nenhum chamador em `src/`, `supabase/functions/` nem `tests/`.
--
-- O QUE ESTE ARQUIVO **NÃO** DERRUBA, e por quê — os dois espelhos que o
-- ticket mandou medir antes de decidir. Medidos em prod, 2026-09-03:
--
--   • `pipeline_entries.stage_key` — 88 funções SQL de prod citam o token.
--     Não é espelho sobrando: é a chave por onde metade do motor filtra etapa,
--     e as 6 views a projetam como `status`. Derrubar exige migrar 88 corpos
--     para `stage_id` + `pipeline_stages.stage_role`. Fica FORA: é ticket
--     próprio, não um DROP a reboque.
--
--   • `leads.pipe_whatsapp` — 5 funções vivas de prod tocam a COLUNA (não a
--     view homônima): `get_leads_no_response_from_lead` e
--     `get_leads_team_no_response` a leem como predicado de funil
--     (`l.pipe_whatsapp IS NOT NULL`); `get_pending_meta_conversion_signals`
--     a lê como etapa (`l.pipe_whatsapp = 'compareceu'`), que é o sinal de
--     conversão que vai para a Meta; `delete_pipeline` a zera; e
--     `sync_pipeline_entry_to_lead_pipe_whatsapp` a escreve por desenho.
--     Os leitores em `supabase/functions/` já estão limpos e travados pelo
--     gate `tests/unit/pipe-whatsapp-espelho-sem-leitores.test.ts`; o que falta
--     é o lado SQL. Fica FORA — é o SCRUM-222.
--
-- COMO AS GUARDAS FUNCIONAM
--   G1 (estrutural, a que importa): varre `pg_get_functiondef` de TODAS as
--       funções plpgsql/sql de `public` no momento do apply e reprova se
--       QUALQUER uma ainda tiver `FROM/JOIN/INSERT INTO/UPDATE/DELETE FROM`
--       sobre um dos 6 nomes. `DROP VIEW ... RESTRICT` não pega isso: corpo de
--       plpgsql não entra em `pg_depend`, então sem esta guarda o DROP passaria
--       verde e as funções quebrariam só na primeira chamada, em produção.
--   G2 (dependência): reprova se outra view/rule depender dos 6 (pg_depend).
--   G3 (tráfego): compara `pg_stat_statements` contra o baseline congelado em
--       2026-09-03 e reprova se qualquer objeto tiver recebido chamada nova.
--       LIMITE HONESTO desta guarda: pgss está em 4880/5000 entradas e evicta
--       por LRU — presença prova chamada, ausência NÃO prova silêncio. G3
--       sozinha não autoriza o DROP; quem autoriza é a janela de 7 dias medida
--       1×/dia (ver `.specs/features/funis-unificacao/checklist-demolicao.md`).
--
-- ROLLBACK pareado: `supabase/migrations/rollback/20270920000000_demolicao_dos_espelhos.sql`
-- — recria as 6 views, as 18 funções, os 18 triggers, os grants e os comments
-- a partir dos corpos EXATOS capturados de prod em 2026-09-03 (viewdef,
-- functiondef, triggerdef), não de memória nem da migration que os criou.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Baseline congelado (prod jsjsmuncfkbsbzqzqhfq, 2026-09-03 16:26Z)
--
--    ESTES NÚMEROS TÊM QUE SER RE-CONGELADOS NO DIA DA APLICAÇÃO. Eles são a
--    régua da G3, e a régua só vale se for do dia: entre a captura de 16:20 e a
--    de 16:26 desta mesma sessão, `custom_pipelines` subiu 13 chamadas e
--    `pipe_whatsapp` subiu 1 — a view estava sendo lida enquanto o arquivo era
--    escrito. Recongele com o último snapshot da janela:
--        node scripts/medir-leitores-espelhos.mjs
--        cat .specs/features/funis-unificacao/medicoes/<hoje>.json
--    e substitua os pares abaixo pelos `nome`/`calls` de lá. Aplicar com
--    baseline velho torna a G3 um carimbo: ela passaria por comparar contra um
--    número que já sabemos ultrapassado.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE _espelho_baseline(nome text PRIMARY KEY, calls bigint) ON COMMIT DROP;
INSERT INTO _espelho_baseline VALUES
  ('pipe_whatsapp',                      242742),
  ('pipe_confirmacao',                   605945),
  ('pipe_propostas',                     256715),
  ('custom_pipe_entries',                 99735),
  ('custom_pipelines',                   228056),
  ('custom_pipeline_stages',             123423),
  ('bulk_add_to_custom_pipe',               154),
  ('custom_pipeline_delete_impact',           0),
  ('delete_custom_pipeline',                  4),
  ('delete_system_pipeline',                  0),
  ('get_custom_filtered_lead_ids',           26),
  ('get_custom_pipeline_stage_counts',     4635),
  ('system_pipeline_delete_impact',           0),
  ('system_stage_role',                       0);

-- ════════════════════════════════════════════════════════════════════════════
-- G1 — nenhuma função de prod pode mais ler/escrever pelos espelhos
-- ════════════════════════════════════════════════════════════════════════════
DO $g1$
DECLARE
  v_ofensores text;
  v_n int;
BEGIN
  WITH f AS (
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND l.lanname IN ('plpgsql','sql')
  ), v(nome) AS (
    SELECT unnest(ARRAY['pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                        'custom_pipe_entries','custom_pipelines','custom_pipeline_stages'])
  )
  SELECT string_agg(DISTINCT f.proname || ' → ' || v.nome, E'\n    ' ORDER BY f.proname || ' → ' || v.nome), count(DISTINCT f.proname)
    INTO v_ofensores, v_n
    FROM f JOIN v
      ON f.def ~* ('(from|join)\s+(public\.)?' || v.nome || '\M')
      OR f.def ~* ('(insert\s+into|update|delete\s+from)\s+(public\.)?' || v.nome || '\M');

  IF v_n > 0 THEN
    RAISE EXCEPTION
      E'G1 REPROVOU — % função(ões) de prod ainda passam pelos espelhos:\n    %\n\n'
      'O caminho canônico é `pipeline_entries` (JOIN `pipelines` por `pipeline_id`) '
      'com o papel da etapa vindo de `pipeline_stages.stage_role`, nunca do nome da '
      'view nem do `status`. Migre estes corpos ANTES de derrubar as views: `DROP VIEW` '
      'não reprova por eles (corpo de plpgsql não entra em pg_depend), então derrubar '
      'agora entrega uma prod que só quebra na primeira chamada.',
      v_n, v_ofensores;
  END IF;
END
$g1$;

-- ════════════════════════════════════════════════════════════════════════════
-- G2 — nenhuma outra view/rule depende dos espelhos
-- ════════════════════════════════════════════════════════════════════════════
DO $g2$
DECLARE v_dep text;
BEGIN
  SELECT string_agg(DISTINCT dep.relname || ' depende de ' || alvo.relname, E'\n    ')
    INTO v_dep
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class dep  ON dep.oid = rw.ev_class
    JOIN pg_class alvo ON alvo.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = alvo.relnamespace
   WHERE n.nspname = 'public'
     AND alvo.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                          'custom_pipe_entries','custom_pipelines','custom_pipeline_stages')
     AND dep.relname <> alvo.relname;

  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION E'G2 REPROVOU — objetos ainda dependem dos espelhos:\n    %', v_dep;
  END IF;
END
$g2$;

-- ════════════════════════════════════════════════════════════════════════════
-- G3 — tráfego novo desde o congelamento (ver LIMITE, no cabeçalho)
-- ════════════════════════════════════════════════════════════════════════════
DO $g3$
DECLARE v_cresceu text;
BEGIN
  SELECT string_agg(
           format('%s: baseline %s → agora %s (+%s)', b.nome, b.calls, x.agora, x.agora - b.calls),
           E'\n    ' ORDER BY b.nome)
    INTO v_cresceu
    FROM _espelho_baseline b
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(s.calls), 0) AS agora
        FROM pg_stat_statements s
       WHERE s.query ~ ('\m' || b.nome || '\M')
         AND s.userid IN (SELECT oid FROM pg_roles WHERE rolname IN ('authenticated','anon','service_role'))
         AND s.query !~* '(^\s*(create|drop|comment|grant|revoke|alter|do)\M|pg_stat_statements|pg_get_functiondef|pg_get_viewdef|demolicao_dos_espelhos)'
    ) x
   WHERE x.agora > b.calls;

  IF v_cresceu IS NOT NULL THEN
    RAISE EXCEPTION
      E'G3 REPROVOU — chamada NOVA desde o congelamento de 2026-09-03:\n    %\n\n'
      'A janela de 7 dias não fechou em zero. Não force: quem chamou é um leitor '
      'vivo que ninguém migrou, e o DROP o quebra em produção.', v_cresceu;
  END IF;
END
$g3$;

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
DROP VIEW IF EXISTS public.pipe_whatsapp;
DROP VIEW IF EXISTS public.pipe_confirmacao;
DROP VIEW IF EXISTS public.pipe_propostas;
DROP VIEW IF EXISTS public.custom_pipe_entries;
DROP VIEW IF EXISTS public.custom_pipeline_stages;
DROP VIEW IF EXISTS public.custom_pipelines;

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

  IF v_views <> 0 OR v_trgfn <> 0 THEN
    RAISE EXCEPTION 'Demolição incompleta: % view(s) e % função(ões) de trigger sobraram.', v_views, v_trgfn;
  END IF;

  RAISE NOTICE 'Espelhos = 0. Funil é Funil entregue (SCRUM-639/D5).';
END
$fim$;

COMMIT;
