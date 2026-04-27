-- Corrigir políticas do bucket de mídia para permitir uploads pelo webhook (service role)
-- Nota: o bucket 'media' é criado em migration posterior, então tudo é condicional

DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow service role uploads" ON storage.objects;
  CREATE POLICY "Allow service role uploads"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'media');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
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
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
