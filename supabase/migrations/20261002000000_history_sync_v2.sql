-- =====================================================
-- History Sync v2 — schema improvements
-- =====================================================
-- New columns for progress tracking, error tracking,
-- incremental sync scope, and auto-sync support.
-- =====================================================

-- A. Progress tracking columns
ALTER TABLE public.history_sync_jobs
  ADD COLUMN IF NOT EXISTS total_chats INTEGER,
  ADD COLUMN IF NOT EXISTS current_chat_index INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chats_completed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chats_skipped INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chat_errors JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS triggered_by TEXT DEFAULT 'user';

-- B. triggered_by CHECK constraint
DO $$ BEGIN
  ALTER TABLE public.history_sync_jobs
    ADD CONSTRAINT history_sync_jobs_triggered_by_check
      CHECK (triggered_by IN ('user', 'auto_connect', 'incremental'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- C. Expand scope CHECK to include 'incremental'
ALTER TABLE public.history_sync_jobs
  DROP CONSTRAINT IF EXISTS history_sync_jobs_scope_check;
ALTER TABLE public.history_sync_jobs
  ADD CONSTRAINT history_sync_jobs_scope_check
    CHECK (scope IN ('default', 'full', 'chat', 'incremental'));

-- D. Index for skip-already-synced queries (improvement #6)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_instance_jid_ts
  ON public.whatsapp_messages(instance_id, remote_jid, "timestamp" DESC);

-- E. Index for auto-sync guard (improvement #4)
CREATE INDEX IF NOT EXISTS idx_history_sync_jobs_instance_completed
  ON public.history_sync_jobs(instance_id, completed_at DESC)
  WHERE status = 'completed';
