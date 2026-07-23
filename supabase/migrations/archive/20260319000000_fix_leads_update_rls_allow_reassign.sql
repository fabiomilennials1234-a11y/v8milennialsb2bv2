-- Migration: Fix leads UPDATE RLS to allow reassigning responsible user
-- Problem: WITH CHECK clause on UPDATE policies checks the NEW row values.
--          When a user changes sdr_id to another person, is_user_responsible()
--          returns FALSE for the NEW row, blocking the update.
-- Fix: WITH CHECK only verifies organization membership (the USING clause
--       already verified the user has permission to access the lead).
-- Date: 2026-03-19

-- Drop both existing UPDATE policies that have the restrictive WITH CHECK
DROP POLICY IF EXISTS "leads_update_by_responsibility" ON public.leads;
DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
DROP POLICY IF EXISTS "leads_update_organization" ON public.leads;

-- Recreate UPDATE policy:
-- USING: full permission check (user must be able to see/access the lead)
-- WITH CHECK: only verify organization membership (allows changing sdr_id/closer_id)
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
    )
  )
  WITH CHECK (
    -- Only verify the lead stays in the user's organization
    -- (USING already confirmed the user has permission to edit this lead)
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );
