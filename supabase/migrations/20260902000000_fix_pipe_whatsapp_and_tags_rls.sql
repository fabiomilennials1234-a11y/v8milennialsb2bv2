-- =============================================================================
-- Fix 2 RLS security findings discovered by integration tests:
--
-- 1. pipe_whatsapp: legacy policies "Pipe WhatsApp visível para autenticados"
--    and "Team members podem gerenciar pipe WhatsApp" use is_team_member()
--    WITHOUT org filtering, allowing cross-tenant reads. The correct
--    org-scoped policies (pipe_whatsapp_select_by_permissions, etc.) already
--    exist but are overridden by the permissive legacy ones.
--
-- 2. tags: INSERT/DELETE policies (tags_insert_organization,
--    tags_delete_organization) allow any org member to write. Combined with
--    the "Apenas admins podem gerenciar tags" policy via OR logic, members
--    bypass the admin-only intent.
-- =============================================================================

-- ─── 1. pipe_whatsapp: drop legacy overly-permissive policies ───────────────

DROP POLICY IF EXISTS "Pipe WhatsApp visível para autenticados" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "Team members podem gerenciar pipe WhatsApp" ON public.pipe_whatsapp;

-- The remaining policies are correct:
-- pipe_whatsapp_select_by_permissions (SELECT, org-scoped + responsibility)
-- pipe_whatsapp_update_by_permissions (UPDATE, org-scoped + responsibility)
-- pipe_whatsapp_insert_organization (INSERT, org-scoped)
-- pipe_whatsapp_delete_configurable (DELETE, org-scoped + can_delete_lead)
-- master_all_pipe_whatsapp (ALL, master bypass)
-- master_select_all_pipe_whatsapp (SELECT, master bypass)

-- ─── 2. tags: restrict write to admin only ──────────────────────────────────

-- Drop member-accessible write policies
DROP POLICY IF EXISTS "tags_insert_organization" ON public.tags;
DROP POLICY IF EXISTS "tags_delete_organization" ON public.tags;
DROP POLICY IF EXISTS "tags_update_organization" ON public.tags;

-- Recreate write policies restricted to admin/master
CREATE POLICY "tags_insert_admin_only" ON public.tags
  FOR INSERT
  WITH CHECK (
    organization_id = get_user_organization_id()
    AND (is_user_admin() OR is_master_user())
  );

CREATE POLICY "tags_update_admin_only" ON public.tags
  FOR UPDATE
  USING (
    organization_id = get_user_organization_id()
    AND (is_user_admin() OR is_master_user())
  );

CREATE POLICY "tags_delete_admin_only" ON public.tags
  FOR DELETE
  USING (
    organization_id = get_user_organization_id()
    AND (is_user_admin() OR is_master_user())
  );

-- SELECT stays as-is: tags_select_organization allows all org members to read

-- Drop the legacy "Apenas admins" FOR ALL policy — it has no org filter,
-- allowing admins to see tags from ALL orgs (cross-tenant leak via OR logic).
-- The new admin-only write policies above + tags_select_organization handle everything.
DROP POLICY IF EXISTS "Apenas admins podem gerenciar tags" ON public.tags;
