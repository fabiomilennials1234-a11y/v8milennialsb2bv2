-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709210147  name: 20270309000001_media_bucket_authenticated_read
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Onda 0 / Slice 0.2 — stop anonymous enumeration of the public media bucket (ADV-2).
-- Pre-apply gate confirmed: both policies are SELECT/{public} scoped to their bucket.
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;

CREATE POLICY "media_read_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'media');

DROP POLICY IF EXISTS "help_media_read" ON storage.objects;

CREATE POLICY "help_media_read_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'help-media');
