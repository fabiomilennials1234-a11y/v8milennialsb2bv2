-- Adding one tag previously enumerated every visible lead in the organization.
-- On Cafe Jurere, responsibility checks exceeded authenticated's 15s timeout.
-- Correlate by primary key while retaining the exact membership test and leads
-- RLS. Do not replace with lead_in_my_org: it bypasses responsibility visibility.
ALTER POLICY lead_tags_insert_organization ON public.lead_tags
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.leads
    WHERE leads.id = lead_tags.lead_id
      AND leads.organization_id IN (
        SELECT team_members.organization_id
        FROM public.team_members
        WHERE team_members.user_id = (SELECT auth.uid())
      )
  )
);
