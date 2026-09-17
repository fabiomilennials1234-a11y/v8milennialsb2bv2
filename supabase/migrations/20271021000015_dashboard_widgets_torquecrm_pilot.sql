-- Pilot only: keep the existing dashboard for every other organization.
-- Preserve all unrelated flags. Missing TorqueCRM in dev is a safe no-op.
UPDATE public.organizations
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
  || '{"dashboard_draggable_widgets": true}'::jsonb
WHERE id = 'b2ad1ffb-e136-4356-846b-9f210f902573'::uuid
  AND name = 'TorqueCRM';
