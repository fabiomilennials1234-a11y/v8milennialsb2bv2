-- ============================================================
-- Migration: Permission tab schema (Pitstop)
-- Description: Expand organization_role_permissions for 5 new can_*
--   keys, refactor RLS policies to use SECURITY DEFINER helpers
--   (avoids Realtime apply_rls recursion), create permission_audit_log
--   table + trigger, and seed-on-insert trigger for new organizations.
--
-- The 3 management features (workflows / team / copilot) live in
-- feature_permissions (via default_value) and the catalog (FE)
-- routes the mutation to the correct table. Engine consults both.
--
-- Date: 2026-05-20
-- ============================================================

-- ============================================================
-- PART 1 — Expand permission_key CHECK constraint
-- ============================================================

ALTER TABLE public.organization_role_permissions
  DROP CONSTRAINT IF EXISTS organization_role_permissions_permission_key_check;

ALTER TABLE public.organization_role_permissions
  ADD CONSTRAINT organization_role_permissions_permission_key_check
  CHECK (permission_key IN (
    -- Legacy (already existed pre-2026-05-20)
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads',
    -- Pre-existed implicitly via team_member_org_permissions / engine branches
    'can_delete_leads',
    -- New, added by permission-tab feature 2026-05-20
    'can_create_leads',
    'can_export_leads',
    'can_move_pipe_records',
    'can_manage_campaigns'
  ));

-- Mirror the constraint on team_member_org_permissions (individual override
-- table) so future per-member overrides cover the same key universe.
ALTER TABLE public.team_member_org_permissions
  DROP CONSTRAINT IF EXISTS team_member_org_permissions_permission_key_check;

ALTER TABLE public.team_member_org_permissions
  ADD CONSTRAINT team_member_org_permissions_permission_key_check
  CHECK (permission_key IN (
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads',
    'can_delete_leads',
    'can_create_leads',
    'can_export_leads',
    'can_move_pipe_records',
    'can_manage_campaigns'
  ));

-- ============================================================
-- PART 2 — Refactor organization_role_permissions RLS policies
-- to use SECURITY DEFINER helpers (avoid Realtime recursion)
-- ============================================================

-- Helpers get_my_organization_ids() and get_my_admin_organization_ids()
-- already exist (created in 20261020000000_fix_realtime_rls_recursion.sql).
-- Re-create defensively (no-op when already correct).

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND role = 'admin'
    AND is_active = true;
$$;

DROP POLICY IF EXISTS "org_role_permissions_select_own_org" ON public.organization_role_permissions;
CREATE POLICY "org_role_permissions_select_own_org"
  ON public.organization_role_permissions FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "org_role_permissions_insert_admin" ON public.organization_role_permissions;
CREATE POLICY "org_role_permissions_insert_admin"
  ON public.organization_role_permissions FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

DROP POLICY IF EXISTS "org_role_permissions_update_admin" ON public.organization_role_permissions;
CREATE POLICY "org_role_permissions_update_admin"
  ON public.organization_role_permissions FOR UPDATE
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

DROP POLICY IF EXISTS "org_role_permissions_delete_admin" ON public.organization_role_permissions;
CREATE POLICY "org_role_permissions_delete_admin"
  ON public.organization_role_permissions FOR DELETE
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()));

-- Allow masters cross-org access.
DROP POLICY IF EXISTS "org_role_permissions_master_all" ON public.organization_role_permissions;
CREATE POLICY "org_role_permissions_master_all"
  ON public.organization_role_permissions FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================================
-- PART 3 — permission_audit_log table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.permission_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  changed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_role TEXT NOT NULL CHECK (changed_by_role IN ('admin', 'master', 'system')),
  table_name TEXT NOT NULL CHECK (table_name IN ('organization_role_permissions', 'feature_permissions')),
  permission_key TEXT NOT NULL,
  role TEXT,
  old_enabled BOOLEAN,
  new_enabled BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.permission_audit_log IS 'Audit trail of permission toggles done via Pitstop > Permissões tab (admin/master) or system seed/backfill.';

CREATE INDEX IF NOT EXISTS idx_permission_audit_log_org_created
  ON public.permission_audit_log(organization_id, created_at DESC);

ALTER TABLE public.permission_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin + Master can read audit log of their org. Inserts only via trigger.
DROP POLICY IF EXISTS "permission_audit_log_select_admin_or_master" ON public.permission_audit_log;
CREATE POLICY "permission_audit_log_select_admin_or_master"
  ON public.permission_audit_log FOR SELECT
  USING (
    public.is_master_user()
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  );

-- INSERT: only via SECURITY DEFINER trigger function (service_role / superuser).
-- No policy → effective deny for authenticated.

-- ============================================================
-- PART 4 — Audit trigger function + triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_permission_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_changed_by_role TEXT := 'system';
  v_org_id UUID;
  v_perm_key TEXT;
  v_role TEXT;
  v_old BOOLEAN;
  v_new BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  -- Identify acting role
  IF v_user_id IS NULL THEN
    v_changed_by_role := 'system';
  ELSIF EXISTS (SELECT 1 FROM public.master_users mu WHERE mu.user_id = v_user_id AND mu.is_active = true) THEN
    v_changed_by_role := 'master';
  ELSIF EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = v_user_id AND tm.role = 'admin' AND tm.is_active = true
  ) THEN
    v_changed_by_role := 'admin';
  ELSE
    -- Member toggling somehow — still log but flag as system (RLS should have stopped it).
    v_changed_by_role := 'system';
  END IF;

  IF TG_TABLE_NAME = 'organization_role_permissions' THEN
    IF (TG_OP = 'INSERT') THEN
      v_org_id   := NEW.organization_id;
      v_perm_key := NEW.permission_key;
      v_role     := NEW.role;
      v_old      := NULL;
      v_new      := NEW.enabled;
    ELSIF (TG_OP = 'UPDATE') THEN
      IF OLD.enabled IS NOT DISTINCT FROM NEW.enabled THEN
        RETURN NEW;
      END IF;
      v_org_id   := NEW.organization_id;
      v_perm_key := NEW.permission_key;
      v_role     := NEW.role;
      v_old      := OLD.enabled;
      v_new      := NEW.enabled;
    ELSIF (TG_OP = 'DELETE') THEN
      v_org_id   := OLD.organization_id;
      v_perm_key := OLD.permission_key;
      v_role     := OLD.role;
      v_old      := OLD.enabled;
      v_new      := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'feature_permissions' THEN
    -- feature_permissions is global (no organization_id). Use NULL org_id
    -- placeholder via a sentinel: skip logging for non-default_value changes.
    IF (TG_OP = 'UPDATE') THEN
      IF OLD.default_value IS NOT DISTINCT FROM NEW.default_value THEN
        RETURN NEW;
      END IF;
      -- Find an org_id to associate (the active acting user's first org).
      SELECT organization_id INTO v_org_id
      FROM public.team_members
      WHERE user_id = v_user_id
      LIMIT 1;
      IF v_org_id IS NULL THEN
        -- No org to attribute — skip rather than insert NULL FK
        RETURN NEW;
      END IF;
      v_perm_key := NEW.key;
      v_role     := 'member';
      v_old      := OLD.default_value;
      v_new      := NEW.default_value;
    ELSE
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  INSERT INTO public.permission_audit_log(
    organization_id, changed_by_user_id, changed_by_role,
    table_name, permission_key, role, old_enabled, new_enabled
  ) VALUES (
    v_org_id, v_user_id, v_changed_by_role,
    TG_TABLE_NAME, v_perm_key, v_role, v_old, v_new
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    -- Never block a permission toggle because audit logging failed.
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_permission_audit_org_role_permissions
  ON public.organization_role_permissions;
CREATE TRIGGER tg_permission_audit_org_role_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.log_permission_change();

DROP TRIGGER IF EXISTS tg_permission_audit_feature_permissions
  ON public.feature_permissions;
CREATE TRIGGER tg_permission_audit_feature_permissions
  AFTER UPDATE ON public.feature_permissions
  FOR EACH ROW EXECUTE FUNCTION public.log_permission_change();

-- ============================================================
-- PART 5 — Seed trigger for new organizations
-- ============================================================
-- Inserts the 9 organization_role_permissions rows for role='member'
-- with enabled=true (defaults-on per CTO decision 2026-05-20).

CREATE OR REPLACE FUNCTION public.seed_member_org_role_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_role_permissions (organization_id, role, permission_key, enabled)
  SELECT NEW.id, 'member', perm, true
  FROM (VALUES
    ('see_unassigned_cards'),
    ('see_subordinates_cards'),
    ('see_general_info'),
    ('see_all_leads'),
    ('can_delete_leads'),
    ('can_create_leads'),
    ('can_export_leads'),
    ('can_move_pipe_records'),
    ('can_manage_campaigns')
  ) AS p(perm)
  ON CONFLICT (organization_id, role, permission_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_seed_org_role_permissions ON public.organizations;
CREATE TRIGGER tg_seed_org_role_permissions
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_member_org_role_permissions();

-- ============================================================
-- PART 6 — Add tables to supabase_realtime publication
-- ============================================================
-- Idempotent via duplicate_object catch.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_role_permissions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_permissions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

COMMENT ON TABLE public.permission_audit_log IS
  'Audit trail of permission toggles via Pitstop. Append-only — populated by trigger log_permission_change(). Read by admins/masters of the org.';
