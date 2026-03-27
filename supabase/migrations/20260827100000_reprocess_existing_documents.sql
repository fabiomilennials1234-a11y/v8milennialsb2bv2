-- =============================================================
-- One-time migration: Reset existing documents for reprocessing
-- with the new multimodal PDF extraction pipeline.
-- Old chunks contain base64 garbage and need to be regenerated.
-- =============================================================

-- Clear broken chunks (contain base64 instead of real text)
DELETE FROM public.copilot_agent_document_chunks;

-- Reset documents to pending so they get reprocessed
UPDATE public.copilot_agent_documents
SET
  status = 'pending',
  summary = NULL,
  content = NULL,
  error_message = NULL,
  updated_at = NOW()
WHERE status IN ('ready', 'error');
