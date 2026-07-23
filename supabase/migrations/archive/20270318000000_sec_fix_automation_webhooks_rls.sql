-- Security hardening — Audit 2026-07-14, Onda 1 / Fatia 2 (finding #11).
-- The four *_by_org policies had a correlated-subquery bug: the IN subquery selected
-- automation_webhooks.organization_id (the OUTER table's own column) instead of the
-- caller's org, so the predicate reduced to organization_id IN (organization_id) = TRUE
-- for every row whenever the caller had any profile row => complete cross-tenant CRUD on
-- every org's webhook configs. Rewrite to the canonical, recursion-safe, master-aware
-- helper get_my_organization_ids(). The master_ghost_* policies already cover master users
-- (left unchanged). Also adds WITH CHECK on UPDATE to block relocating a row into another org.

DROP POLICY IF EXISTS automation_webhooks_select_by_org ON public.automation_webhooks;
CREATE POLICY automation_webhooks_select_by_org ON public.automation_webhooks
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS automation_webhooks_insert_by_org ON public.automation_webhooks;
CREATE POLICY automation_webhooks_insert_by_org ON public.automation_webhooks
  FOR INSERT WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS automation_webhooks_update_by_org ON public.automation_webhooks;
CREATE POLICY automation_webhooks_update_by_org ON public.automation_webhooks
  FOR UPDATE USING (organization_id IN (SELECT get_my_organization_ids()))
             WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS automation_webhooks_delete_by_org ON public.automation_webhooks;
CREATE POLICY automation_webhooks_delete_by_org ON public.automation_webhooks
  FOR DELETE USING (organization_id IN (SELECT get_my_organization_ids()));
