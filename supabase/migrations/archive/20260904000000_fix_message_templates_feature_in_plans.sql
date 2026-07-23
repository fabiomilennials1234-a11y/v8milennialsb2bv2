-- ================================================================
-- Hotfix: Add message_templates feature to torque-2.0 and torque-v8 plans
--
-- Root cause: migration 20260330200000 tried to UPDATE plans that
-- didn't exist yet (created later by 20260830000000), and the
-- checkout migration didn't include message_templates in the
-- features JSONB.
-- ================================================================

UPDATE public.subscription_plans
SET features = features || '{"message_templates": true}'::JSONB
WHERE name IN ('torque-2.0', 'torque-v8');
