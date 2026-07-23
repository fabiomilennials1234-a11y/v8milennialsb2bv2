-- =================================================================
-- Master First-Class: Add master bypass RLS to 7 blocked tables
--
-- Problem:
--   Master users without team_member records cannot access:
--   workflows, conversation_messages, lead_history,
--   custom_pipe_entries, lead_scores, goals, awards
--
-- Solution:
--   Add master_select_all / master_all policies using is_master_user()
--   Same pattern as existing master policies on leads, campanhas, etc.
--
-- PRD: #413 | Issue: #415
-- =================================================================

BEGIN;

-- ============================================
-- 1. workflows
-- ============================================
DROP POLICY IF EXISTS "master_select_all_workflows" ON public.workflows;
CREATE POLICY "master_select_all_workflows" ON public.workflows
  FOR SELECT TO authenticated
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_workflows" ON public.workflows;
CREATE POLICY "master_all_workflows" ON public.workflows
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- 2. conversation_messages
-- ============================================
DROP POLICY IF EXISTS "master_select_all_conversation_messages" ON public.conversation_messages;
CREATE POLICY "master_select_all_conversation_messages" ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_conversation_messages" ON public.conversation_messages;
CREATE POLICY "master_all_conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- 3. lead_history
-- ============================================
DROP POLICY IF EXISTS "master_select_all_lead_history" ON public.lead_history;
CREATE POLICY "master_select_all_lead_history" ON public.lead_history
  FOR SELECT TO authenticated
  USING (public.is_master_user());

-- lead_history is append-only, no need for ALL policy
DROP POLICY IF EXISTS "master_insert_lead_history" ON public.lead_history;
CREATE POLICY "master_insert_lead_history" ON public.lead_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_master_user());

-- ============================================
-- 4. custom_pipe_entries
-- ============================================
DROP POLICY IF EXISTS "master_select_all_custom_pipe_entries" ON public.custom_pipe_entries;
CREATE POLICY "master_select_all_custom_pipe_entries" ON public.custom_pipe_entries
  FOR SELECT TO authenticated
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_custom_pipe_entries" ON public.custom_pipe_entries;
CREATE POLICY "master_all_custom_pipe_entries" ON public.custom_pipe_entries
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- 5. lead_scores
-- ============================================
DROP POLICY IF EXISTS "master_select_all_lead_scores" ON public.lead_scores;
CREATE POLICY "master_select_all_lead_scores" ON public.lead_scores
  FOR SELECT TO authenticated
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_lead_scores" ON public.lead_scores;
CREATE POLICY "master_all_lead_scores" ON public.lead_scores
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- 6. goals — fix AND logic, add master bypass
-- ============================================
DROP POLICY IF EXISTS "master_select_all_goals" ON public.goals;
CREATE POLICY "master_select_all_goals" ON public.goals
  FOR SELECT TO authenticated
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_goals" ON public.goals;
CREATE POLICY "master_all_goals" ON public.goals
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- 7. awards
-- ============================================
DROP POLICY IF EXISTS "master_select_all_awards" ON public.awards;
CREATE POLICY "master_select_all_awards" ON public.awards
  FOR SELECT TO authenticated
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_awards" ON public.awards;
CREATE POLICY "master_all_awards" ON public.awards
  FOR ALL TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

COMMIT;
