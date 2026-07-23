-- ============================================================
-- Saved Views — named filter presets per entity/page
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saved_views IS 'Named filter presets for leads/pipe pages';
COMMENT ON COLUMN public.saved_views.entity_type IS 'Target page: leads, whatsapp, confirmacao, propostas, custom:<pipeline_id>';
COMMENT ON COLUMN public.saved_views.filters IS 'JSON blob matching the page filter state shape. __me__ placeholder = current user team_member_id';
COMMENT ON COLUMN public.saved_views.is_system IS 'System-seeded defaults, not deletable by users';

CREATE INDEX idx_saved_views_org_entity
  ON public.saved_views (organization_id, entity_type);

CREATE INDEX idx_saved_views_owner
  ON public.saved_views (owner_id);

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_views_select ON public.saved_views
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
    AND (owner_id = auth.uid() OR is_shared = true)
  );

CREATE POLICY saved_views_insert ON public.saved_views
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND owner_id = auth.uid()
  );

CREATE POLICY saved_views_update ON public.saved_views
  FOR UPDATE USING (
    organization_id = public.get_user_organization_id()
    AND owner_id = auth.uid()
  );

CREATE POLICY saved_views_delete ON public.saved_views
  FOR DELETE USING (
    organization_id = public.get_user_organization_id()
    AND owner_id = auth.uid()
    AND is_system = false
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;

CREATE TRIGGER set_saved_views_updated_at
  BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMIT;
