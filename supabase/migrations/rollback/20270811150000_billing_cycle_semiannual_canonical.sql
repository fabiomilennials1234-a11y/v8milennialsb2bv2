-- Rollback de 20270811150000_billing_cycle_semiannual_canonical.sql
--
-- Devolve os dois CHECK ao vocabulário do baseline (`semester`).
--
-- ATENÇÃO — ISTO REINTRODUZ O DEFEITO DE PROPÓSITO. Depois deste rollback,
-- `org_subscriptions` volta a ter dois CHECK contraditórios: este, exigindo
-- `semester`, e o `org_subscriptions_billing_cycle_valid` de
-- 20270807000002, exigindo `semiannual`. O domínio efetivo volta a ser a
-- interseção {monthly, annual}, e o ciclo semestral deixa de existir no schema
-- outra vez — com a regra "Pix só em semestral ou anual" valendo só para anual.
--
-- SÓ É SEGURO ENQUANTO NÃO HOUVER LINHA COM `semiannual`. Se o billing já
-- escreveu, este rollback FALHA no ADD CONSTRAINT (a linha existente viola o
-- predicado antigo), e isso é o comportamento desejado: melhor falhar barulhento
-- do que apagar dado de cobrança para satisfazer um CHECK. Nesse caso o caminho
-- é corrigir para frente, não para trás.
--
-- Confira antes:
--     SELECT billing_cycle, count(*) FROM public.org_subscriptions GROUP BY 1;
--     SELECT billing_cycle, count(*) FROM public.payment_history  GROUP BY 1;

ALTER TABLE public.org_subscriptions
  DROP CONSTRAINT IF EXISTS org_subscriptions_billing_cycle_check;

ALTER TABLE public.org_subscriptions
  ADD CONSTRAINT org_subscriptions_billing_cycle_check
    CHECK (billing_cycle = ANY (ARRAY['monthly'::text, 'semester'::text, 'annual'::text]));

ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_billing_cycle_check;

ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_billing_cycle_check
    CHECK (billing_cycle = ANY (ARRAY['monthly'::text, 'semester'::text, 'annual'::text]));
