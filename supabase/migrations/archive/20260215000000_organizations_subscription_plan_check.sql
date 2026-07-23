-- Migration: Allow free and starter in organizations.subscription_plan
-- Description: Alinha CHECK com subscription_plans (free, starter, pro, enterprise).
--              Master pode criar organizações com plano free/starter sem violar constraint.
-- Date: 2026-02-15

-- Drop existing CHECK (nome padrão no PostgreSQL para coluna)
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_plan_check;

-- Add new CHECK incluindo free e starter
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_plan_check
  CHECK (subscription_plan IS NULL OR subscription_plan IN ('basic', 'free', 'starter', 'pro', 'enterprise'));

COMMENT ON COLUMN public.organizations.subscription_plan IS 'Plano: free, starter, pro, enterprise (alinhado a subscription_plans.name)';
