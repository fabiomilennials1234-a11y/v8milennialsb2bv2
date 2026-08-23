-- 20270811100000_metrics_studio_rollout_flag.sql
--
-- G5 do grill de 2026-08-11 (.specs/features/metricas-v2/SPEC.md §1.7):
-- trava de liberação PRÓPRIA do Estúdio de Métricas (/metricas).
--
-- POR QUE NÃO REUSAR `composable_metrics_enabled`
--
-- Aquela flag tem efeito colateral: `trg_seed_dashboard_on_flag_enabled`
-- dispara em AFTER UPDATE OF composable_metrics_enabled e semeia 2 páginas +
-- 13 widgets, trocando a TV legada pela montável. Reusá-la significaria que
-- liberar Métricas para um cliente TAMBÉM troca a TV dele, sem ele ter pedido —
-- e que não dá para desligar uma sem desligar a outra.
--
-- Medido em 2026-08-11: composable_metrics_enabled está ON em 1 de 99 orgs.
--
-- DDL PURA (guarda F4): só acrescenta coluna com default. NÃO liga a flag para
-- ninguém — habilitar org é dado de cliente e é botão do humano, feito fora do
-- apply. A coluna nasce `false`, então o comportamento não muda para ninguém no
-- momento em que esta migration roda.
--
-- Sem função nova, logo sem a armadilha do GRANT. A leitura vai pela RLS que
-- `organizations` já tem, exatamente como `useComposableMetricsEnabled` faz
-- hoje com a flag irmã.
--
-- ROLLBACK pareado: rollback/20270811100000_metrics_studio_rollout_flag.sql

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS metrics_studio_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.metrics_studio_enabled IS
  'Rollout do Estúdio de Métricas (/metricas), SCRUM-310 · G5. Independente de '
  'composable_metrics_enabled de propósito: aquela arrasta o re-seed da TV '
  'junto. Default false — liberar org é ato deliberado, um UPDATE por vez.';
