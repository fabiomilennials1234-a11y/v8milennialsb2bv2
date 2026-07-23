-- P1: Rewrite lead_tags RLS to avoid recursive leads RLS evaluation.
--
-- Problem: lead_tags_select_by_lead does inline SELECT FROM leads,
-- which triggers full leads RLS (6+ SECURITY DEFINER functions per row).
-- Combined with PostgREST lateral joins, this multiplies cost per pipeline entry.
--
-- Fix: SECURITY DEFINER function does a direct PK lookup on leads with org check,
-- bypassing leads RLS entirely. Trade-off: lead_tags visibility is now org-scoped
-- (not responsibility-scoped), but lead data itself remains protected by leads RLS.
-- Tag associations without lead context are not sensitive.

CREATE OR REPLACE FUNCTION public.lead_in_my_org(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id
      AND deleted_at IS NULL
      AND organization_id IN (SELECT public.get_my_organization_ids())
  );
$$;

GRANT EXECUTE ON FUNCTION public.lead_in_my_org(uuid) TO authenticated;

-- Replace SELECT policy (critical — fires on every pipeline query)
DROP POLICY IF EXISTS "lead_tags_select_by_lead" ON public.lead_tags;
CREATE POLICY "lead_tags_select_by_lead" ON public.lead_tags
  FOR SELECT
  USING (public.lead_in_my_org(lead_id));

-- Replace UPDATE policy (same inline leads problem)
DROP POLICY IF EXISTS "lead_tags_update_by_lead" ON public.lead_tags;
CREATE POLICY "lead_tags_update_by_lead" ON public.lead_tags
  FOR UPDATE
  USING (public.lead_in_my_org(lead_id))
  WITH CHECK (public.lead_in_my_org(lead_id));

-- Replace DELETE policies (same inline leads problem)
DROP POLICY IF EXISTS "lead_tags_delete_by_lead" ON public.lead_tags;
CREATE POLICY "lead_tags_delete_by_lead" ON public.lead_tags
  FOR DELETE
  USING (public.lead_in_my_org(lead_id));

DROP POLICY IF EXISTS "lead_tags_delete_configurable" ON public.lead_tags;
CREATE POLICY "lead_tags_delete_configurable" ON public.lead_tags
  FOR DELETE
  USING (public.can_delete_lead() AND public.lead_in_my_org(lead_id));
