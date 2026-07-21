-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715125836  name: sec_fix_automation_webhooks_rls
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Security hardening — Audit 2026-07-14, Onda 1 / Fatia 2 (finding #11).
-- Fix correlated-subquery bug that reduced org isolation to always-true; rewrite to
-- get_my_organization_ids(); add WITH CHECK on UPDATE. master_ghost_* policies unchanged.

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
