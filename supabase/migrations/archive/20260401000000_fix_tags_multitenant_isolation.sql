-- Fix tags multi-tenant isolation
-- Problem: tags with organization_id = NULL are visible to ALL organizations
-- and the UNIQUE constraint on name is global, causing cross-org conflicts.

-- ============================================
-- 1. Assign legacy NULL-org tags to Milennials org
-- ============================================
UPDATE public.tags
SET organization_id = (
  SELECT id FROM public.organizations
  WHERE (
    name ILIKE '%milennial%' OR name ILIKE '%millennial%'
    OR slug ILIKE '%milennial%' OR slug ILIKE '%millennial%'
  )
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
WHERE organization_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.organizations
    WHERE (
      name ILIKE '%milennial%' OR name ILIKE '%millennial%'
      OR slug ILIKE '%milennial%' OR slug ILIKE '%millennial%'
    )
    LIMIT 1
  );

-- ============================================
-- 2. Replace global UNIQUE(name) with per-org UNIQUE(name, organization_id)
-- ============================================
ALTER TABLE public.tags DROP CONSTRAINT IF EXISTS tags_name_key;
ALTER TABLE public.tags DROP CONSTRAINT IF EXISTS tags_name_organization_unique;
ALTER TABLE public.tags ADD CONSTRAINT tags_name_organization_unique UNIQUE (name, organization_id);

-- ============================================
-- 3. Fix RLS policies — remove "organization_id IS NULL" legacy fallback
-- ============================================

-- SELECT
DROP POLICY IF EXISTS "tags_select_organization" ON public.tags;
CREATE POLICY "tags_select_organization"
  ON public.tags FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
  );

-- INSERT
DROP POLICY IF EXISTS "tags_insert_organization" ON public.tags;
CREATE POLICY "tags_insert_organization"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_user_organization_id()
  );

-- UPDATE
DROP POLICY IF EXISTS "tags_update_organization" ON public.tags;
CREATE POLICY "tags_update_organization"
  ON public.tags FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
  );

-- DELETE
DROP POLICY IF EXISTS "tags_delete_organization" ON public.tags;
CREATE POLICY "tags_delete_organization"
  ON public.tags FOR DELETE
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
  );

-- ============================================
-- 4. Make organization_id NOT NULL for future inserts
-- ============================================
ALTER TABLE public.tags ALTER COLUMN organization_id SET NOT NULL;

COMMENT ON TABLE public.tags IS 'Tags are scoped by organization_id; legacy NULL rows were assigned to the Milennials org.';
