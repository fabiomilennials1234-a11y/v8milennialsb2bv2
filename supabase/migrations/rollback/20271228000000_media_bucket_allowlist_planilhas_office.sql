-- Rollback de 20271228000000_media_bucket_allowlist_planilhas_office.sql.
--
-- Faça ANTES: desligar a flag na org e reverter o front. Sem isso a tela de
-- Templates continua oferecendo .xlsx/.csv e o upload passa a ser recusado.
--
-- Arquivos já enviados continuam lidos (o allowlist só governa upload novo).
-- Templates que apontam para planilha seguem enviando; só não dá para subir outro.
--
--   UPDATE organizations
--      SET feature_flags = feature_flags - 'template_anexos_office'
--    WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT mime FROM unnest(allowed_mime_types) AS mime
  WHERE mime NOT IN (
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain'
  )
)
WHERE id = 'media';
