-- 20270730000001_deny_all_pipeline_entries_revert_backup.sql
--
-- Fecha a segunda porta de `pipeline_entries_revert_20260514`, tabela de backup
-- com `organization_id` que estava SEM RLS em produção. É a única violação
-- restante do INV-3 (`supabase/tests/rls_invariants.sql`).
--
-- ESTADO MEDIDO ANTES (prod, 2026-07-30)
-- --------------------------------------
--   4.188 linhas, 24 organizações, RLS desligada.
--   GRANT para `authenticated`: nenhum. Para `anon`: nenhum.
--
-- Ou seja: NÃO havia vazamento. A porta de fora (GRANT) estava trancada. O que
-- faltava era a de dentro — e é ela que impede um `GRANT ... ON ALL TABLES IN
-- SCHEMA public` futuro, escrito sem pensar, de expor 4.188 registros de 24
-- clientes de uma vez. Defesa em profundidade, não remendo de incidente.
--
-- POR QUE A TABELA NÃO FOI DROPADA
-- --------------------------------
-- O descarte foi considerado e recusado com o número na mesa:
--   3.903 das 4.188 linhas NÃO existem na `pipeline_entries` viva;
--   os leads correspondentes continuam todos existindo;
--   só 28 têm o mesmo par (lead, funil) vivo hoje;
--   e o ledger canônico `pipeline_stage_events` cobre 1 (uma) delas.
-- Isto é, esta tabela é hoje o ÚNICO registro de onde ~3.9 mil leads de 24
-- clientes estavam nos funis em 14/05/2026. Dropar é perda de histórico, não
-- faxina.
--
-- CONDIÇÃO PARA DROPAR NO FUTURO: gerar os eventos faltantes em
-- `pipeline_stage_events`. Quando o ledger cobrir estas linhas, a tabela vira
-- redundante e o DROP fica trivial.
--
-- ROLLBACK pareado: rollback/20270730000001_deny_all_pipeline_entries_revert_backup.sql

ALTER TABLE public.pipeline_entries_revert_20260514 ENABLE ROW LEVEL SECURITY;

-- Sem policy nenhuma: RLS ligada e catálogo vazio = deny-all para qualquer role
-- que não seja service_role (que bypassa por BYPASSRLS).

-- A primeira porta passa a ser explícita em vez de acidental.
REVOKE ALL ON public.pipeline_entries_revert_20260514 FROM PUBLIC;
REVOKE ALL ON public.pipeline_entries_revert_20260514 FROM anon;
REVOKE ALL ON public.pipeline_entries_revert_20260514 FROM authenticated;

COMMENT ON TABLE public.pipeline_entries_revert_20260514 IS
  'BACKUP de pipeline_entries em 14/05/2026. NÃO DROPAR sem antes cobrir estas '
  'linhas em pipeline_stage_events: em 2026-07-30, 3.903 das 4.188 linhas não '
  'existiam mais na tabela viva e o ledger canônico cobria 1 delas — é o único '
  'registro de onde ~3.9 mil leads de 24 clientes estavam nos funis naquela data. '
  'RLS deny-all + zero GRANT: só service_role alcança.';
