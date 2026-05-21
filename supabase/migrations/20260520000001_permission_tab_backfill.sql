-- ============================================================
-- Migration: Backfill organization_role_permissions for the
--   Permissions tab launch.
--
-- Behavior:
--   • Inserts member-role rows for any organization missing the 9 keys
--     (idempotent via ON CONFLICT DO NOTHING).
--   • Flips legacy keys (see_*) from default=false to enabled=true
--     for ALL existing member rows. Justified by CTO 2026-05-20:
--     defaults-on aligned with how the new tab is documented.
--   • New can_* keys inserted with enabled=true.
--
-- Pre-flight (run in PROD before applying — see comment block below):
--   SELECT DISTINCT organization_id FROM team_member_permissions
--   WHERE resource_key NOT IN ('leads','campanhas','pipe') AND value='denied';
--   (Existing per-pipe orphan rows. Engine no longer reads matrix for
--    move_pipe_record from 2026-05-20 onward — these denials are not
--    deleted; they are simply ignored.)
-- ============================================================

-- Step 1: Insert missing member-role rows for every existing org.
INSERT INTO public.organization_role_permissions (organization_id, role, permission_key, enabled)
SELECT o.id, 'member', p.permission_key, true
FROM public.organizations o
CROSS JOIN (VALUES
  ('see_unassigned_cards'),
  ('see_subordinates_cards'),
  ('see_general_info'),
  ('see_all_leads'),
  ('can_delete_leads'),
  ('can_create_leads'),
  ('can_export_leads'),
  ('can_move_pipe_records'),
  ('can_manage_campaigns')
) AS p(permission_key)
ON CONFLICT (organization_id, role, permission_key) DO NOTHING;

-- Step 2: Flip enabled=true on existing legacy see_* rows (CTO 2026-05-20).
-- can_delete_leads stays whatever it was (org may have already configured it).
UPDATE public.organization_role_permissions
SET enabled = true, updated_at = NOW()
WHERE role = 'member'
  AND permission_key IN (
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads'
  )
  AND enabled = false;
