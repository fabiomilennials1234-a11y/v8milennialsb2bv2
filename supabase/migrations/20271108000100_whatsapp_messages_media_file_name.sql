-- 20271108000100_whatsapp_messages_media_file_name.sql
--
-- Chamado f6fc3c9e — a bolha de documento no chat nunca mostrou o nome original
-- do arquivo. O nome chega do provider no payload (Uazapi:
-- `raw_payload.content.fileName` / `.title`; Meta Cloud API:
-- `raw_payload.document.filename`), mas o cron `raw-payload-retention` zera o
-- `raw_payload` com 14 dias. Ler só o payload faria o nome sumir em duas
-- semanas; por isso o nome ganha coluna própria, gravada no INSERT.
--
-- ORDEM DE DEPLOY: esta migration vai para prod ANTES do frontend que projeta
-- `media_file_name` (sem a coluna o PostgREST devolve 400 e a thread do chat
-- fica vazia em todas as orgs).
--
-- Custo:
--   * ADD COLUMN nullable sem default = só catálogo, sem rewrite da tabela.
--   * Backfill: só documentos que ainda têm payload (~14 dias; ~4,8 k linhas em
--     2026-10-06, todas as orgs). Medido antes — abaixo do limiar de ~50 k que
--     pediria lotes. Os triggers de UPDATE de `whatsapp_messages` são
--     `UPDATE OF status, lead_id, instance_id` e `UPDATE OF phone_number`: um
--     SET em `media_file_name` não dispara nenhum (nem webhook). Por isso NÃO
--     se mexe em `session_replication_role`.
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS, e o
-- backfill só toca linhas com `media_file_name IS NULL`.
-- Rollback: supabase/migrations/rollback/20271108000100_whatsapp_messages_media_file_name.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_file_name text;

COMMENT ON COLUMN public.whatsapp_messages.media_file_name IS
  'Nome original do arquivo de um documento, copiado do raw_payload no INSERT '
  '(sobrevive à retenção de 14 dias do raw_payload). NULL = desconhecido.';

-- Expressão única, usada pelo trigger e pelo backfill.
CREATE OR REPLACE FUNCTION public.whatsapp_messages_extract_media_file_name(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT left(
    nullif(
      btrim(
        coalesce(
          nullif(btrim(p_payload->'content'->>'fileName'), ''),
          nullif(btrim(p_payload->'content'->>'title'), ''),
          nullif(btrim(p_payload->'document'->>'filename'), '')
        )
      ),
      ''
    ),
    255
  );
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_messages_set_media_file_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.media_file_name := public.whatsapp_messages_extract_media_file_name(NEW.raw_payload);
  RETURN NEW;
END;
$$;

-- Só funções de trigger/infra: ninguém chama por RPC.
REVOKE ALL ON FUNCTION public.whatsapp_messages_set_media_file_name() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_messages_extract_media_file_name(jsonb) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_messages_set_media_file_name ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_set_media_file_name
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (
    NEW.media_file_name IS NULL
    AND NEW.raw_payload IS NOT NULL
    AND NEW.message_type = 'document'
  )
  EXECUTE FUNCTION public.whatsapp_messages_set_media_file_name();

-- Backfill: só o que ainda tem payload. Os documentos mais antigos que 14 dias
-- já perderam o nome — o frontend mostra "Documento" para eles.
UPDATE public.whatsapp_messages
   SET media_file_name = public.whatsapp_messages_extract_media_file_name(raw_payload)
 WHERE message_type = 'document'
   AND media_file_name IS NULL
   AND raw_payload IS NOT NULL
   AND public.whatsapp_messages_extract_media_file_name(raw_payload) IS NOT NULL;

COMMIT;
