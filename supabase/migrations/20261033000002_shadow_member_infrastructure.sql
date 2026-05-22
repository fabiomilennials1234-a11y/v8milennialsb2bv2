-- =================================================================
-- Master First-Class: Shadow member infrastructure
--
-- Three additions:
--   1. is_shadow column on team_members
--   2. team_members_visible view (excludes shadow + inactive)
--   3. ensure_master_team_member() RPC for auto-provisioning
--
-- PRD: #413 | Issue: #416
-- =================================================================

BEGIN;

-- ============================================
-- 1. Add is_shadow column
-- ============================================
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN NOT NULL DEFAULT false;

-- Index for view performance
CREATE INDEX IF NOT EXISTS idx_team_members_shadow
  ON public.team_members (is_shadow)
  WHERE is_shadow = true;

-- ============================================
-- 2. Unique constraint for idempotent provisioning
--    (user can only have one team_member per org)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_members_user_org_unique'
  ) THEN
    ALTER TABLE public.team_members
      ADD CONSTRAINT team_members_user_org_unique
      UNIQUE (user_id, organization_id);
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'Duplicate team_members rows exist — skipping constraint. Clean up first.';
END $$;

-- ============================================
-- 3. View: team_members_visible
--    Excludes shadow and inactive members.
--    Uses security_invoker so caller's RLS applies.
-- ============================================
CREATE OR REPLACE VIEW public.team_members_visible
WITH (security_invoker = true)
AS
  SELECT *
  FROM public.team_members
  WHERE NOT is_shadow
    AND is_active = true;

GRANT SELECT ON public.team_members_visible TO authenticated;
GRANT SELECT ON public.team_members_visible TO service_role;

-- ============================================
-- 4. RPC: ensure_master_team_member
--    Creates shadow team_member for master in target org.
--    Idempotent via ON CONFLICT.
--    Fails for non-master users.
-- ============================================
CREATE OR REPLACE FUNCTION public.ensure_master_team_member(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_tm_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Gate: only master users can call this
  IF NOT public.is_master_user(v_user_id) THEN
    RAISE EXCEPTION 'Only master users can provision shadow team members'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- Check if already exists (shadow or real)
  SELECT id INTO v_tm_id
  FROM public.team_members
  WHERE user_id = v_user_id
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_tm_id IS NOT NULL THEN
    RETURN v_tm_id;
  END IF;

  -- Insert shadow member
  INSERT INTO public.team_members (
    user_id,
    organization_id,
    name,
    role,
    is_active,
    is_shadow
  ) VALUES (
    v_user_id,
    p_org_id,
    'Master',
    'admin',
    true,
    true
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET is_active = true,
        is_shadow = true,
        role = 'admin'
  RETURNING id INTO v_tm_id;

  RETURN v_tm_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_master_team_member(UUID) TO authenticated;

COMMIT;
