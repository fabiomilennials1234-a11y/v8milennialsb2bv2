-- Disparo envia PDF e Word, nao so imagem (Chamado dac7e647).
--
-- O assistente de Disparo (/disparos/novo) e o backend do plano so carregavam
-- imagem: blast_plans tinha so image_url. Um PDF aparecia na tela e saia do
-- payload em silencio (o disparo ia so com texto); Word era recusado.
--
-- O QUE MUDA
--  1. blast_plans ganha o anexo canonico: media_url, media_type ('image' |
--     'document') e media_name (o nome do arquivo que o lead ve, ate 255).
--     Aditiva, sem default, sem backfill: image_url segue lido (o leitor do
--     plano cai para ele quando media_url e nulo) e um plano de IMAGEM continua
--     gravando so image_url. So o plano de DOCUMENTO usa as colunas novas.
--  2. CHECKs: media_type no enum; media_url e media_type andam juntos; nome ate
--     255. Tabela pequena (9 planos em prod em 20/10/2026): validacao imediata.
--  3. Bucket `media`: acrescenta os MIMEs de Word (.doc e .docx) ao
--     allowed_mime_types. A ultima definicao no repo
--     (archive/20270722000000_media_bucket_drop_video_webm.sql) aceita PDF e nao
--     aceita Word: sem isto o upload do .docx e recusado pelo Storage antes de
--     chegar ao disparo. So ACRESCENTA (preserva a lista e a ordem), so se
--     faltar, e so quando o bucket tem allowlist (NULL = aceita tudo, nao mexe).
--
-- ORDEM DE DEPLOY: esta migration -> edge functions -> front.
-- Idempotente: pode rodar de novo sem efeito.

BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.blast_plans
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_name text;

COMMENT ON COLUMN public.blast_plans.media_url IS
  'Anexo do disparo: URL publica do bucket media. NULL em plano de texto e em plano de imagem legado (que usa image_url).';
COMMENT ON COLUMN public.blast_plans.media_type IS
  'Tipo do anexo: image | document (PDF/Word). Anda junto com media_url.';
COMMENT ON COLUMN public.blast_plans.media_name IS
  'Nome do arquivo que o lead ve no WhatsApp (docName). Ate 255 caracteres.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'blast_plans_media_type_check'
      AND conrelid = 'public.blast_plans'::regclass
  ) THEN
    ALTER TABLE public.blast_plans
      ADD CONSTRAINT blast_plans_media_type_check
      CHECK (media_type IS NULL OR media_type IN ('image', 'document'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'blast_plans_media_pair_check'
      AND conrelid = 'public.blast_plans'::regclass
  ) THEN
    ALTER TABLE public.blast_plans
      ADD CONSTRAINT blast_plans_media_pair_check
      CHECK ((media_url IS NULL) = (media_type IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'blast_plans_media_name_length_check'
      AND conrelid = 'public.blast_plans'::regclass
  ) THEN
    ALTER TABLE public.blast_plans
      ADD CONSTRAINT blast_plans_media_name_length_check
      CHECK (media_name IS NULL OR char_length(media_name) <= 255);
  END IF;
END
$$;

UPDATE storage.buckets
SET allowed_mime_types = allowed_mime_types || ARRAY(
  SELECT m
  FROM unnest(ARRAY[
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]) AS m
  WHERE m <> ALL (allowed_mime_types)
)
WHERE id = 'media'
  AND allowed_mime_types IS NOT NULL
  AND NOT allowed_mime_types @> ARRAY[
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

COMMIT;
