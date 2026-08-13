-- ROLLBACK de 20270811100000_metrics_studio_rollout_flag.sql
--
-- ⚠ DROP COLUMN é IRREVERSÍVEL e apaga quais orgs estavam liberadas. Exige
-- aprovação explícita do CTO, como toda remoção de coluna neste repo.
--
-- Na prática, quase nunca é isto que se quer: para desligar o Estúdio sem
-- perder o registro do rollout, basta
--
--   UPDATE public.organizations SET metrics_studio_enabled = false;
--
-- que zera o acesso e mantém a coluna. O front degrada para "indisponível"
-- sozinho, sem deploy.
--
-- O DROP abaixo só faz sentido ao abandonar a feature inteira.

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS metrics_studio_enabled;
