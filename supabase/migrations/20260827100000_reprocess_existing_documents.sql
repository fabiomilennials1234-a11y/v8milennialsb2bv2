-- =============================================================
-- One-time migration: Reset existing documents for reprocessing
-- with the new multimodal PDF extraction pipeline.
-- Old chunks contain base64 garbage and need to be regenerated.
-- =============================================================

-- Clear broken chunks (skip if table doesn't exist — pgvector may not be available locally)
DO $$ BEGIN
  DELETE FROM public.copilot_agent_document_chunks;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'copilot_agent_document_chunks does not exist — skipping chunk cleanup';
END $$;

-- Reset documents to pending so they get reprocessed
UPDATE public.copilot_agent_documents
SET
  status = 'pending',
  summary = NULL,
  content = NULL,
  error_message = NULL,
  updated_at = NOW()
WHERE status IN ('ready', 'error');
