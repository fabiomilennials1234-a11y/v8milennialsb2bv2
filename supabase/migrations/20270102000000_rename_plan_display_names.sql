-- Rename plan display labels (branding only). Slugs (name) untouched:
--   torque-1.0 / torque-2.0 / torque-v8 stay as identifiers used by
--   feature-gating (OrgFeaturesContext.plan_name), organizations.subscription_plan,
--   the CHECK constraint, and external /signup?plan=<slug> links.
-- Only display_name changes:
--   Torque 1.0 -> Torque Base       (CRM base)
--   Torque 2.0 -> Torque Automation (comunicação + automação)
--   Torque V8  -> Torque Copilot    (IA / copilot)

UPDATE public.subscription_plans SET display_name = 'Torque Base',       updated_at = now() WHERE name = 'torque-1.0';
UPDATE public.subscription_plans SET display_name = 'Torque Automation', updated_at = now() WHERE name = 'torque-2.0';
UPDATE public.subscription_plans SET display_name = 'Torque Copilot',    updated_at = now() WHERE name = 'torque-v8';
