-- Corrigir políticas do bucket de mídia para permitir uploads pelo webhook (service role)

-- Permitir upload pelo service role (webhook) - service role já bypassa RLS, mas garantir que o bucket aceita
DROP POLICY IF EXISTS "Allow service role uploads" ON storage.objects;
CREATE POLICY "Allow service role uploads"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'media');

-- Garantir que o bucket tem os mime types corretos
UPDATE storage.buckets 
SET allowed_mime_types = ARRAY[
  'image/jpeg', 
  'image/png', 
  'image/gif', 
  'image/webp',
  'audio/webm',
  'audio/ogg',
  'audio/mp4', 
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
  'audio/x-m4a',
  'video/mp4', 
  'video/webm',
  'application/pdf',
  'application/octet-stream'
]
WHERE id = 'media';
