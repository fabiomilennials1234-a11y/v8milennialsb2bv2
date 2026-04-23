-- Media Knowledge Base: support images and videos in copilot knowledge base
-- Uses Gemini Embedding 2 multimodal to embed media directly (no text extraction)

-- 1. Add file_type to classify documents vs media
ALTER TABLE copilot_agent_documents
  ADD COLUMN IF NOT EXISTS file_type TEXT NOT NULL DEFAULT 'document';

-- 2. Add description (what the media is about) and send_when (when to send it)
ALTER TABLE copilot_agent_documents
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS send_when TEXT;

-- 3. Index for filtering by file_type
CREATE INDEX IF NOT EXISTS idx_agent_documents_file_type
  ON copilot_agent_documents (agent_id, file_type)
  WHERE file_type IN ('image', 'video');

COMMENT ON COLUMN copilot_agent_documents.file_type IS 'document | image | video';
COMMENT ON COLUMN copilot_agent_documents.description IS 'Human description of media content for LLM context';
COMMENT ON COLUMN copilot_agent_documents.send_when IS 'Natural language instruction: when should the copilot send this media';
