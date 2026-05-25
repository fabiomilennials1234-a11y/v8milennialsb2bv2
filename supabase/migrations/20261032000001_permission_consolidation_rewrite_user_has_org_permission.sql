-- ============================================================================
-- Permission Consolidation — Phase 2: Rewrite user_has_org_permission()
-- PRD #408
--
-- Same signature, new body. Maps legacy org permission keys to feature keys
-- and delegates to has_feature_permission(). Zero RLS policy changes needed.
--
-- Mapping:
--   see_unassigned_cards   → leads.view_unassigned
--   see_subordinates_cards → leads.view_subordinates
--   see_general_info       → leads.view_general_info
--   see_all_leads          → leads.view_all
--   can_delete_leads       → leads.delete
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_has_org_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Admin always has all permissions
    (SELECT true WHERE public.has_role(auth.uid(), 'admin')),
    -- Map org key → feature key → delegate to has_feature_permission
    (SELECT public.has_feature_permission(
      CASE p_permission_key
        WHEN 'see_unassigned_cards'   THEN 'leads.view_unassigned'
        WHEN 'see_subordinates_cards' THEN 'leads.view_subordinates'
        WHEN 'see_general_info'       THEN 'leads.view_general_info'
        WHEN 'see_all_leads'          THEN 'leads.view_all'
        WHEN 'can_delete_leads'       THEN 'leads.delete'
      END
    )),
    -- Unknown key or unmapped → false (fail-closed)
    false
  )
$$;
