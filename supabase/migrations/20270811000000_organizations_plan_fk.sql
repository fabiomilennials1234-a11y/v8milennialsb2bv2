-- 20270811000000_organizations_plan_fk.sql
--
-- SCRUM-337 (Passo 2) — `organizations.subscription_plan` deixa de ser validada
-- por uma lista de literais escrita à mão e passa a REFERENCIAR o catálogo.
--
-- POR QUÊ
--
-- `organizations_subscription_plan_check` era uma segunda cópia do catálogo, e
-- já estava fora de sincronia: permitia `basic`, que NÃO existe em
-- `subscription_plans`. Uma org marcada como `basic` passava pelo CHECK e
-- depois caía no `COALESCE(sp.features, '{}')` do fallback de
-- `org_get_features_and_limits` — perdia TODAS as features em silêncio. Não é
-- permissão pendurada; é apagão.
--
-- Mesmo defeito de fundo do `plan_id` (dois lugares guardando o mesmo fato,
-- divergindo) que a decisão #1382 mandou matar, e o oposto do princípio de
-- #1386 ("a tabela manda"), já adotado para o `feature_catalog`.
--
-- SEMÂNTICA (decidida em grill com o CTO, 2026-08-11)
--
--   ON UPDATE CASCADE  — renomear um plano leva junto as orgs que apontam pra
--                        ele. O nome é rótulo; a identidade é a linha.
--   ON DELETE RESTRICT — apagar plano com org é recusado. SET NULL reproduziria
--                        o apagão; CASCADE apagaria as organizações.
--
-- NULO continua permitido — sem `NOT NULL` e sem `DEFAULT`. `NOT NULL`
-- quebraria `create_org_sandbox` e o edge `test-workflow-system`, que inserem
-- org sem plano.
--
-- DADOS: só schema, sem backfill. Medido em produção antes desta migration:
-- 0 organizações apontam para plano inexistente, então a FK valida limpo. As
-- 2 orgs com plano NULO (`__integration_test_org__` e `QA Test Org`, 0 membros
-- e 0 leads) seguem válidas — a FK não olha NULO.
--
-- `subscription_plans.name` já tem UNIQUE (`subscription_plans_name_key`), que
-- é o que torna a FK possível hoje.
--
-- Prova: supabase/tests/organizations_plan_fk_test.sql

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_plan_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_plan_fkey
  FOREIGN KEY (subscription_plan)
  REFERENCES public.subscription_plans(name)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT organizations_subscription_plan_fkey ON public.organizations IS
  'SCRUM-337: o catálogo (subscription_plans) manda. Substitui o CHECK de 8 literais, que permitia `basic` — nome ausente do catálogo, que zerava as features da org no fallback de org_get_features_and_limits.';
