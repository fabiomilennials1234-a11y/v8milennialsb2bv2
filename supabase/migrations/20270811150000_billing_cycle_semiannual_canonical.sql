-- 20270811150000_billing_cycle_semiannual_canonical.sql
--
-- O ciclo semestral NÃO ENTRA EM NENHUMA DAS DUAS TABELAS DE COBRANÇA HOJE.
-- Nem `semester`, nem `semiannual`. Provado por execução em transação revertida:
-- `monthly` aceita, `annual` aceita, os dois nomes do semestre são recusados.
--
-- A CAUSA está no repositório, não em drift de produção. A migration
-- 20270807000002_subscription_snapshot_base_layer.sql (fatia 3 do billing,
-- aplicada em prod em 04/08) ADICIONA em `org_subscriptions`:
--
--     ADD CONSTRAINT org_subscriptions_billing_cycle_valid
--       CHECK (billing_cycle IN ('monthly','semiannual','annual'))
--
-- e NÃO derruba o `org_subscriptions_billing_cycle_check` que o baseline já
-- trazia (baseline:25605) exigindo ('monthly','semester','annual'). Dois CHECK
-- sobre a mesma coluna são ANDados, então o domínio efetivo virou a interseção:
-- {monthly, annual}. O defeito nasceu junto com a fundação que ele deveria
-- sustentar, e está invisível há uma semana porque nada escreve ainda.
--
-- CONSEQUÊNCIA DE NEGÓCIO, não só de schema: a regra "Pix só em semestral ou
-- anual" (gravada em `org_subscriptions_pix_long_cycle_only` e em
-- `_shared/payments/policy.ts`) hoje vale só para anual, porque semestral não
-- entra. Metade da regra comercial está morta.
--
-- NOME CANÔNICO ESCOLHIDO: `semiannual`. Não é preferência estética — é onde o
-- vocabulário já vive. `semiannual` está na camada nova inteira: os CHECK de
-- 20270807000002, o `billing_price_engine` (valida o domínio, mapeia para 6
-- meses e busca o desconto), `_shared/payments/{types,policy,asaas-provider}.ts`
-- com seus testes, e a `PricingSection` da landing pública, que já mostra
-- "Semestral" com a chave `semiannual`. A Asaas fala `SEMIANNUALLY` e o
-- provider já traduz `semiannual` <-> `SEMIANNUALLY`. `semester` sobrevive
-- apenas nos dois CHECK legados desta migration. Custo do lado do código: ZERO
-- arquivo muda.
--
-- DÍVIDA NOMEADA, deixada de propósito: a coluna `subscription_plans
-- .discount_semester_pct` mantém o nome antigo. O `billing_price_engine` JÁ a lê
-- quando o ciclo é `semiannual`, o que prova que nome de COLUNA e vocabulário de
-- VALOR são coisas separadas. Renomear a coluna arrastaria o types.ts gerado, o
-- PlanEditor.tsx e o useMasterPlans.ts, sem ganhar nada de correção. Fica como
-- dívida cosmética COM NOME — dívida sem nome vira surpresa.
--
-- REDUNDÂNCIA ACEITA, também nomeada: depois desta migration `org_subscriptions`
-- passa a ter dois CHECK com o MESMO domínio
-- (`org_subscriptions_billing_cycle_check` e
-- `org_subscriptions_billing_cycle_valid`). É inofensivo — ANDar dois predicados
-- idênticos não muda nada — e derrubar um deles está fora do escopo desta
-- fatia. Quem consolidar depois, consolide os dois de uma vez.
--
-- PRÉ-CONDIÇÃO MEDIDA EM PROD EM 2026-08-11: `org_subscriptions` = 0 linhas e
-- `payment_history` = 0 linhas. Nenhuma linha com `semester`, então o
-- DROP/CREATE não encontra dado para violar e NÃO existe operação de dado
-- separada. Se esta migration demorar a ser aplicada e o billing começar a
-- escrever, a pré-condição muda: re-meça com
--     SELECT billing_cycle, count(*) FROM public.payment_history GROUP BY 1;
--     SELECT billing_cycle, count(*) FROM public.org_subscriptions GROUP BY 1;
-- antes de aplicar. Número medido tem prazo de validade.
--
-- ESCOPO: schema puro. Sem DO block, sem backfill, sem tocar em dado de
-- cliente (guarda F4).
--
-- Rollback pareado: supabase/migrations/rollback/20270811150000_billing_cycle_semiannual_canonical.sql

-- ---------------------------------------------------------------------------
-- org_subscriptions
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_subscriptions
  DROP CONSTRAINT IF EXISTS org_subscriptions_billing_cycle_check;

ALTER TABLE public.org_subscriptions
  ADD CONSTRAINT org_subscriptions_billing_cycle_check
    CHECK (billing_cycle = ANY (ARRAY['monthly'::text, 'semiannual'::text, 'annual'::text]));

-- ---------------------------------------------------------------------------
-- payment_history
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_billing_cycle_check;

ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_billing_cycle_check
    CHECK (billing_cycle = ANY (ARRAY['monthly'::text, 'semiannual'::text, 'annual'::text]));
