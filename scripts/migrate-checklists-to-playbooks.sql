-- Run AFTER 20271207000000, before deploying V5. No old work items are copied.
-- Run as postgres/service_role. Re-running is safe, serialized by organization.
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.task_activate(id) FROM public.organizations WHERE ui_v5_enabled ORDER BY id;
COMMIT;
