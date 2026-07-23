-- Fix: Garantir que organizations.subscription_plan aceite free e starter
-- O constraint antigo (20260124000000) só permite basic, pro, enterprise.
-- O app cria organizações com subscription_plan = 'free' por padrão, o que viola o constraint antigo.
-- Remove o CHECK antigo e adiciona o correto.

-- Nome padrão no PostgreSQL para CHECK inline é tablename_columnname_check
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_plan_check;

-- Adicionar o constraint correto: free, starter, pro, enterprise (+ basic e NULL)
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_plan_check
  CHECK (subscription_plan IS NULL OR subscription_plan IN ('basic', 'free', 'starter', 'pro', 'enterprise'));

COMMENT ON COLUMN public.organizations.subscription_plan IS 'Plano: free, starter, pro, enterprise (alinhado a subscription_plans.name)';
