-- =============================================================================
-- Copilot Builder — backfill finalized_at (PRD #544 / Slice #551)
-- =============================================================================
-- finalized_at was added nullable with no backfill (20261110000000). Every
-- pre-existing agent therefore has finalized_at = NULL, which the draft-hiding
-- filter would treat as an unfinished Builder draft and hide.
--
-- All current agents are real (the Builder shipped after this point and had no
-- way to create drafts before it), so mark them finalized at their creation
-- time. From here on, only genuine Builder drafts carry finalized_at IS NULL.
-- =============================================================================

UPDATE public.copilot_agents
   SET finalized_at = created_at
 WHERE finalized_at IS NULL;
