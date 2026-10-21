-- Rollback do anexo PDF/Word no Disparo (20271211000000, Chamado dac7e647).
--
-- Faca ANTES: reverter o front e as edge functions (blast-plan-create grava
-- media_* em plano de documento; blast-plan-release le). Sem isso, criar plano
-- de documento falha com coluna inexistente.
--
-- Planos de DOCUMENTO ja criados perdem o anexo: as proximas levas saem so com
-- texto. Confira antes quantos sao:
--   SELECT id, status, media_name FROM public.blast_plans WHERE media_url IS NOT NULL;
-- Planos de imagem nao sao afetados (seguem em image_url).
--
-- O allowlist do bucket `media` NAO e revertido de proposito: nao foi possivel
-- ler o valor de prod antes da migration (o schema storage nao e legivel pelo
-- MCP), e tirar Word de um bucket que talvez ja o aceitasse quebraria outros
-- uploads (tela de Templates). Se precisar mesmo:
--   UPDATE storage.buckets
--   SET allowed_mime_types = array_remove(array_remove(allowed_mime_types,
--     'application/msword'),
--     'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
--   WHERE id = 'media';

BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.blast_plans
  DROP CONSTRAINT IF EXISTS blast_plans_media_name_length_check,
  DROP CONSTRAINT IF EXISTS blast_plans_media_pair_check,
  DROP CONSTRAINT IF EXISTS blast_plans_media_type_check;

ALTER TABLE public.blast_plans
  DROP COLUMN IF EXISTS media_name,
  DROP COLUMN IF EXISTS media_type,
  DROP COLUMN IF EXISTS media_url;

COMMIT;
