-- =============================================================================
-- Copilot v1 — recover orphaned agents stuck with finalized_at IS NULL
-- =============================================================================
-- copilot_agents IS the v1 engine (v2 lives in isolated copilot_v2_* tables).
-- The finalized_at draft marker + the agents-list filter (.not finalized_at is
-- null) exist only for the Milennials-only Builder wizard (copilot_builder flag).
--
-- The standard "Novo Copilot" wizard (CopilotPlayground create branch) inserted
-- v1 agents without finalized_at. The list hides finalized_at IS NULL (treating
-- it as a Builder draft), so every v1 agent created through that path in a
-- non-Builder org (e.g. Jakhro) became invisible in the UI while still counting
-- against the max_copilot_agents quota.
--
-- Code fix: the create payload now sets finalized_at at insert time. This
-- migration recovers the agents already orphaned by the bug.
--
-- Targeted, NOT blanket: genuine Builder drafts (in-progress builds) own a row
-- in builder_sessions and must keep finalized_at IS NULL. We only graduate
-- agents that have NO Builder session — i.e. real agents from the standard
-- wizard that were never drafts.
-- =============================================================================

UPDATE public.copilot_agents
   SET finalized_at = created_at
 WHERE finalized_at IS NULL
   AND id NOT IN (SELECT agent_id FROM public.builder_sessions);
