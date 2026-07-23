-- Master ghost RLS for checklists / checklist_items.
--
-- Problem: public.checklists and public.checklist_items have RLS enabled but
-- LOST their master_ghost_* policies that sibling tables (acoes_do_dia,
-- custom_pipe_entries, leads, pipeline_entries, ...) have. The only INSERT
-- policy is org-member (WITH CHECK organization_id IN get_my_organization_ids()),
-- so a master user who is NOT a team_member of the target org cannot INSERT
-- (new row violates row-level security policy).
--
-- Fix: add the exact "ghost master" idiom already present on the sibling
-- tables (FOR SELECT / FOR ALL USING/WITH CHECK is_master_user()). Master is
-- invisible (ghost) and has full access. Org-member policies are PERMISSIVE
-- and combine via OR, so they keep working unchanged for non-master users.
--
-- is_master_user() is SECURITY DEFINER STABLE — no inline team_members
-- subquery, so it does NOT trigger the Realtime apply_rls() recursion gotcha.
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE. Safe to run twice.
-- NOT applied to prod in this change — branch + push only (CTO authorizes prod).

BEGIN;

-- ── checklists ──────────────────────────────────────────────

DROP POLICY IF EXISTS "master_ghost_select_checklists" ON public.checklists;
CREATE POLICY "master_ghost_select_checklists" ON public.checklists
  FOR SELECT USING (public.is_master_user());

DROP POLICY IF EXISTS "master_ghost_all_checklists" ON public.checklists;
CREATE POLICY "master_ghost_all_checklists" ON public.checklists
  FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user());

-- ── checklist_items ─────────────────────────────────────────

DROP POLICY IF EXISTS "master_ghost_select_checklist_items" ON public.checklist_items;
CREATE POLICY "master_ghost_select_checklist_items" ON public.checklist_items
  FOR SELECT USING (public.is_master_user());

DROP POLICY IF EXISTS "master_ghost_all_checklist_items" ON public.checklist_items;
CREATE POLICY "master_ghost_all_checklist_items" ON public.checklist_items
  FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user());

COMMIT;
