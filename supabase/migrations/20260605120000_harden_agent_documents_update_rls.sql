-- Harden UPDATE policy on copilot_agent_documents.
--
-- The original policy (20260325000000_add_agent_documents.sql) declared only a
-- USING clause and no WITH CHECK. Per the project RLS rule, every UPDATE policy
-- must carry WITH CHECK — without it a member could rewrite organization_id to
-- another tenant (privilege escalation), because USING only gates which rows are
-- *visible* to the UPDATE, not what the row may become.
--
-- This is surfaced now because the Copilot Playground starts allowing in-place
-- edits of document metadata (description / send_when) via UPDATE. Same org
-- scoping as the existing INSERT/SELECT/DELETE policies (inline team_members
-- subquery — this table is not Realtime-subscribed, so the recursion gotcha that
-- mandates get_my_organization_ids() elsewhere does not apply here; we match the
-- table's existing policy style for consistency).

DROP POLICY IF EXISTS "org_members_update_agent_documents" ON public.copilot_agent_documents;

CREATE POLICY "org_members_update_agent_documents"
ON public.copilot_agent_documents
FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);
