-- ============================================================
-- Remove políticas RLS permissivas de copilot que sobrepunham
-- as novas policies members_can_manage_copilot_* via OR-logic.
--
-- copilot_agent_faqs_all_org:    FOR ALL verificava apenas org membership
-- copilot_kanban_rules_all_org:  idem — qualquer membro da org tinha acesso
-- ============================================================

DROP POLICY IF EXISTS "copilot_agent_faqs_all_org"    ON public.copilot_agent_faqs;
DROP POLICY IF EXISTS "copilot_kanban_rules_all_org"  ON public.copilot_agent_kanban_rules;
