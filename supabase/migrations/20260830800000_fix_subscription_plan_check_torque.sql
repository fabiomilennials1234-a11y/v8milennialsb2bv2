-- Fix: CHECK constraint on organizations.subscription_plan must include Torque plans
-- The constraint only allowed legacy plans (basic, free, starter, pro, enterprise)
-- but the new Torque plans (torque-1.0, torque-2.0, torque-v8) were added without updating it.

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_plan_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_plan_check
  CHECK (subscription_plan IS NULL OR subscription_plan IN (
    'basic', 'free', 'starter', 'pro', 'enterprise',
    'torque-1.0', 'torque-2.0', 'torque-v8'
  ));

COMMENT ON COLUMN public.organizations.subscription_plan IS 'Plano: legacy (free, starter, pro, enterprise) ou Torque (torque-1.0, torque-2.0, torque-v8)';
