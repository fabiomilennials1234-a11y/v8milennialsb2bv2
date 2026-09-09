-- 20270824100000_metric_custom_definitions_master_ghost.sql
--
-- ⚠️ NASCEU COMO `20270824070000` E FOI RENUMERADA. Aquele número já estava
-- ocupado no ledger de PROD por `api_list_pipelines_inclui_etapas_custom`, de
-- outra frente, que o tomou entre a checagem de versão desta branch e o apply.
-- É a armadilha registrada em `.specs/features/metricas-v2/` §motor: `db push`
-- PULA em silêncio arquivo cuja versão já consta no ledger, e a migration
-- nunca chegaria em prod sem ninguém ser avisado.
-- `scripts/check-migration-versions.sh` não pega isto: ele compara o repo
-- consigo mesmo, nunca com o ledger de prod.
--
-- SINTOMA: ao tentar criar uma métrica personalizada no Estúdio, o usuário
-- MASTER recebe
--
--   new row violates row-level security policy for table "metric_custom_definitions"
--
-- CAUSA-RAIZ. As policies de escrita de `metric_custom_definitions`
-- (20270813110000) isolam por `get_my_team_admin_organization_ids()`, cujo corpo
-- é `team_members WHERE user_id = auth.uid() AND role = 'admin' AND is_active`.
-- Master NÃO tem linha em `team_members` — é camada à parte (`is_master_user()`),
-- fora do enum `app_role`. A helper devolve conjunto vazio e o `WITH CHECK`
-- reprova.
--
-- POR QUE O BOTÃO APARECEU. `MetricsStudio.tsx` calcula `podeCompor` a partir de
-- `useCurrentTeamMember()`, justamente para NÃO usar `useIdentity().isAdmin`
-- (que devolve 'admin' para master). Só que `useCurrentTeamMember` monta um
-- TEAM MEMBER VIRTUAL para master — `buildVirtualTeamMember` devolve
-- `role: "admin", is_active: true` (useCurrentTeamMember.ts:60-63). O guarda
-- media a mesma coisa que queria evitar, por outro caminho. O comentário do
-- código dizia que master "veria o botão e levaria erro na gravação" — era
-- exatamente o que acontecia.
--
-- A ESCOLHA. Duas saídas eram possíveis: esconder o botão do master, ou dar ao
-- master a policy que ele não tinha. Escolhida a segunda, porque:
--
--   1. É o padrão do repositório. `master_ghost_all_<tabela>` existe em dezenas
--      de tabelas (acoes_do_dia, agent_decision_logs, automation_webhooks,
--      awards, badges, builder_sessions, ...). Master operar dentro da org do
--      cliente é o modelo de suporte do produto, não exceção.
--   2. Sem ela o master nem LISTA as métricas personalizadas: a policy de SELECT
--      usa `get_my_organization_ids()`, que também é vazia para master. A tela
--      ficava meio-cega, não só meio-muda.
--   3. Esconder o botão deixaria a feature sem caminho de suporte — e o master
--      continua sendo quem configura org de cliente.
--
-- O QUE ESTA MIGRATION **NÃO** MUDA. A narrow-ness deliberada do crivo de
-- segurança (.specs/features/metricas-v2/security-review.md) continua de pé:
-- `get_my_team_admin_organization_ids()` segue sendo a helper das policies de
-- tenant, e o GESTOR DE PORTFÓLIO (ADR-0021) segue SEM escrita, porque ele não
-- é master nem admin de equipe. A única identidade acrescentada é master.
--
-- DDL PURA (guarda F4): só policy. Nenhum INSERT/UPDATE de dado de cliente.
--
-- ROLLBACK pareado:
--   rollback/20270824100000_metric_custom_definitions_master_ghost.sql

DROP POLICY IF EXISTS master_ghost_all_metric_custom_definitions
  ON public.metric_custom_definitions;

CREATE POLICY master_ghost_all_metric_custom_definitions
  ON public.metric_custom_definitions
  FOR ALL
  -- `( SELECT is_master_user() )` e não `is_master_user()` cru: embrulhado em
  -- SELECT o planejador o trata como InitPlan e avalia UMA vez por query, em
  -- vez de uma vez por linha. É a forma usada pelas outras master_ghost.
  USING (( SELECT public.is_master_user() ))
  WITH CHECK (( SELECT public.is_master_user() ));

COMMENT ON POLICY master_ghost_all_metric_custom_definitions
  ON public.metric_custom_definitions IS
  'Master opera métricas personalizadas dentro da org do cliente (suporte). '
  'Gestor de portfólio (ADR-0021) continua SEM escrita — só admin de equipe e master.';

-- Guarda que roda em TODO apply: se a policy não existir ao final, aborta a
-- transação em vez de deixar o apply "verde" com o bug intacto.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'metric_custom_definitions'
      AND p.polname = 'master_ghost_all_metric_custom_definitions'
  ) THEN
    RAISE EXCEPTION 'master_ghost_all_metric_custom_definitions não foi criada';
  END IF;

  -- As policies de tenant NÃO podem ter sumido no caminho. Se alguém "alinhar"
  -- as helpers um dia, esta linha reprova antes de o apply concluir.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'metric_custom_definitions'
      AND p.polname = 'metric_custom_definitions_insert'
      AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%get_my_team_admin_organization_ids%'
  ) THEN
    RAISE EXCEPTION 'policy de INSERT por tenant sumiu ou trocou de helper';
  END IF;
END $$;
