-- Update agent-documents bucket to accept images and videos for Media Knowledge Base
-- Increases file size limit to 20MB and adds image/video MIME types

UPDATE storage.buckets
SET
  file_size_limit = 20971520,  -- 20MB (was 10MB)
  allowed_mime_types = ARRAY[
    -- Documents (existing)
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    -- Images (new)
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    -- Videos (new)
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
WHERE id = 'agent-documents';
