-- Criar bucket para mídia do WhatsApp
-- Este bucket armazena imagens e áudios enviados pelo chat

-- Criar bucket se não existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true, -- público para que a Evolution API possa acessar
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'video/mp4', 'video/webm', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'video/mp4', 'video/webm', 'application/pdf'];

-- Política para permitir upload por usuários autenticados
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media');

-- Política para permitir leitura pública (necessário para Evolution API acessar)
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'media');

-- Política para permitir usuários atualizarem seus próprios arquivos
DROP POLICY IF EXISTS "Allow authenticated updates" ON storage.objects;
CREATE POLICY "Allow authenticated updates"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'media');

-- Política para permitir usuários deletarem seus próprios arquivos
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;
CREATE POLICY "Allow authenticated deletes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'media');
