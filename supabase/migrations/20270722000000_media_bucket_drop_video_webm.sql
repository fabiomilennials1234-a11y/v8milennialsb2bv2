-- 20270722000000_media_bucket_drop_video_webm.sql
--
-- Remove `video/webm` do allowlist de MIME do bucket `media`.
--
-- Motivo: o WhatsApp não entrega webm. Aceitar o upload só empurra a falha para
-- o fim da linha (o envio falha silenciosamente no provider, depois do node já
-- ter "rodado"). A ação send_whatsapp_video aceita MP4 apenas, e o validador do
-- client já rejeita webm — esta migration fecha a mesma porta no storage.
--
-- Risco: zero. Verificado em prod: 5.240 objetos de vídeo no bucket, 100%
-- `video/mp4`, nenhum `video/webm`. Nada existente é invalidado (o allowlist
-- só governa uploads novos).
--
-- Todo o resto do allowlist é preservado, inclusive `audio/webm` — que NÃO é
-- afetado: é o formato de gravação de áudio do browser e segue em uso.

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
  'video/mp4',
  'application/pdf'
]
WHERE id = 'media';
