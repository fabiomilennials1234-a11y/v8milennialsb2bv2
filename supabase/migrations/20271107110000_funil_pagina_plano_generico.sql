-- 20271107110000_funil_pagina_plano_generico.sql
-- Antes de aplicar: reconferir o topo do ledger de prod
-- (supabase_migrations.schema_migrations). Em 2026-10-05 o topo era
-- 20271106000010; renumerar se outra migration tiver passado à frente.
--
-- `get_pipeline_page` e `get_pipeline_stage_counts_by_id` passam a usar sempre
-- o plano GENÉRICO do PL/pgSQL: `SET plan_cache_mode = force_generic_plan`.
-- Só isso. ALTER FUNCTION não toca corpo, assinatura, RETURNS, SECURITY nem ACL.
--
-- ── O PROBLEMA ─────────────────────────────────────────────────────────────
-- `get_pipeline_page` é o 2º maior consumidor de tempo do PostgREST no pico:
-- 4.636 chamadas/h, 3.334 s/h, média 719 ms, p95 2,07 s. As duas funções são
-- PL/pgSQL com filtros "pega-tudo" (`p_x IS NULL OR …`) e SECURITY INVOKER: a
-- policy de `leads` (leads_select_by_responsibility_and_permissions) entra no
-- plano da query interna.
--
-- ── O QUE FOI MEDIDO (prod, 2026-10-05, só leitura, BEGIN sem COMMIT) ──────
-- Como `authenticated` com claims reais, mesma função, mesmos argumentos, o
-- modo de plano forçado por SET LOCAL (mesmo escopo que o SET da função):
--
--   get_pipeline_page, membro (role member), etapa de 2.278 cards, 20 por página
--     plano ESPECÍFICO (custom): Bitmap Heap Scan da etapa inteira (2.278
--       linhas) → policy de leads por linha → top-N sort.
--       29.145 buffers, 676 ms de execução; 650–730 ms/chamada em regime.
--     plano GENÉRICO: Index Scan em idx_pe_pipeline_stage_created, LIMIT para
--       em 20 linhas. 1.749 buffers; 5,7–6,3 ms/chamada em regime.
--     Com filtros (média das chamadas 2–4, custom → genérico):
--       cursor pág. 10   660 → 6,1 ms     cursor pág. 100   103 → 6,3 ms
--       responsável      656 → 9,4 ms     busca "silva"      693 → 16 ms
--       busca sem achado 672 → 164 ms
--   get_pipeline_page, admin, etapa 'novo' de 2.996 cards
--     custom ~17 ms/chamada (≈12 ms são PLANEJAMENTO); genérico ~3,6 ms.
--   get_pipeline_stage_counts_by_id
--     membro: custom 797 ms → genérico 181 ms. admin: 14 → 16 ms (neutro).
--
--   Em `auto` (padrão), as 5 primeiras chamadas de cada conexão saem no plano
--   específico (180–200 ms no membro) e só a 6ª passa ao genérico (6 ms) —
--   quando o custo estimado do genérico não perde para a média dos específicos.
--   pg_stat_statements é bimodal e compatível com isso: na chamada PostgREST
--   de get_pipeline_page (2026-10-05, após o restart), mín. 1,3 ms (genérico),
--   máx. 1.821 ms, média 103 ms em 1.954 chamadas.
--
-- ⚠ A hipótese que originou esta trilha era a INVERSA (genérico varre a etapa,
--   corrigir com force_custom_plan). Medido, force_custom_plan PIORA tudo:
--   ~100× no membro e ~4,7× no admin. Ver o CONTEXT PACKET da trilha.
--
-- ── POR QUE O GENÉRICO GANHA ───────────────────────────────────────────────
-- Com os valores na mão, o planejador vê `organization_id = <const>` e monta um
-- BitmapAnd (etapa ∩ org), subestimando o custo das funções da policy de leads;
-- avalia a policy nas 2.278 linhas e ordena. Sem os valores, o único caminho
-- seguro é o índice ordenado (pipeline_id, stage_key, created_at) com o LIMIT
-- descendo pelo Nested Loop — para em 20. O plano genérico é construído uma vez
-- por conexão e serve qualquer etapa e filtro; planejar a query (≈12 ms, 1.700
-- buffers só de catálogo) deixa de ser pago a cada chamada.
--
-- ── POR QUE FUNCIONA (PostgreSQL 17) ───────────────────────────────────────
-- runtime-config-query, plan_cache_mode: "Prepared statements (either
--   explicitly prepared or implicitly generated, for example by PL/pgSQL) can
--   be executed using custom or generic plans. […] This setting is considered
--   when a cached plan is to be executed, not when it is prepared."
-- sql-createfunction, SET: "causes the specified configuration parameter to be
--   set to the specified value when the function is entered, and then restored
--   to its prior value when the function exits."
-- Logo, o RETURN QUERY de cada função executa com o modo forçado, e nada vaza
-- para o resto da transação do PostgREST. Comprovado em PGlite (PG 17) por
-- tests/integration/pipeline-page-plan-cache-mode.test.mjs.
--
-- Escopo do SET: vale durante a chamada inteira, inclusive para as funções que
-- a policy chama dentro da query. As medidas acima foram feitas exatamente
-- nesse escopo (SET LOCAL na transação), então já o incluem.
--
-- ── O QUE NÃO MUDA ─────────────────────────────────────────────────────────
-- Corpo (md5 do prosrc igual ao de prod em 2026-10-05: get_pipeline_page
-- 5e77632f6d575d30b27d8977da81a0bd, counts df02e1583326d8836f0d3a913dda3896),
-- SECURITY INVOKER, search_path='' e ACL {postgres, authenticated, service_role}.
-- Autorização segue inteira na RLS; nenhum grant é emitido aqui.
--
-- ── ALTERNATIVA AVALIADA E DESCARTADA ──────────────────────────────────────
-- `RETURN QUERY EXECUTE` com predicados montados só para os filtros presentes:
-- sempre replaneja (paga os ~12 ms de planejamento por chamada) e, sem filtro,
-- cai no mesmo plano específico de 676 ms acima. Não resolve.
--
-- ── REVERSÃO ───────────────────────────────────────────────────────────────
-- supabase/migrations/rollback/20271107110000_funil_pagina_plano_generico.sql
-- (ALTER FUNCTION … RESET plan_cache_mode — volta ao `auto`).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamp with time zone,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,text[],text[],boolean,text[],text[],integer,integer,uuid)
  SET plan_cache_mode = force_generic_plan;

ALTER FUNCTION public.get_pipeline_stage_counts_by_id(uuid,uuid,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,text[],text[],boolean,text[],text[],integer,integer)
  SET plan_cache_mode = force_generic_plan;

-- Guardas: a migration se recusa a concluir errada.
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.proconfig, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_pipeline_page', 'get_pipeline_stage_counts_by_id')
  LOOP
    IF NOT ('plan_cache_mode=force_generic_plan' = ANY (v_fn.proconfig)) THEN
      RAISE EXCEPTION '% sem plan_cache_mode=force_generic_plan (sobrecarga nova?)', v_fn.sig;
    END IF;
    IF NOT ('search_path=""' = ANY (v_fn.proconfig)) THEN
      RAISE EXCEPTION '% perdeu search_path vazio', v_fn.sig;
    END IF;
    IF v_fn.prosecdef THEN
      RAISE EXCEPTION '% virou SECURITY DEFINER', v_fn.sig;
    END IF;
    IF has_function_privilege('anon', v_fn.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon tem EXECUTE em %', v_fn.sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn.sig, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '% perdeu EXECUTE de authenticated/service_role', v_fn.sig;
    END IF;
  END LOOP;
END $$;

COMMIT;
