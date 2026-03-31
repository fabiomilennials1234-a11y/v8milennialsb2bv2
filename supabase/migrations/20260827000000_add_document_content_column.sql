-- =============================================================
-- Migration: Add content column to copilot_agent_documents
-- Stores the full extracted text from documents for:
--   1. Accurate chunking/embedding (RAG)
--   2. Re-processing without re-downloading
--   3. Direct content access by agent engine
-- =============================================================

-- Add content column for raw extracted text
ALTER TABLE public.copilot_agent_documents
  ADD COLUMN IF NOT EXISTS content TEXT DEFAULT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.copilot_agent_documents.content IS
  'Full extracted text content from the document. Used as source for summary generation, chunking, and embedding. NULL means extraction not yet run or failed.';
