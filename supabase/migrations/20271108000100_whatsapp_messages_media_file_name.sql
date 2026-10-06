-- 20271108000100_whatsapp_messages_media_file_name.sql
--
-- Chamado f6fc3c9e — a bolha de documento no chat nunca mostrou o nome original
-- do arquivo. O nome chega do provider no payload (Uazapi:
-- `raw_payload.content.fileName` / `.title`; Meta Cloud API:
-- `raw_payload.document.filename`), mas o cron `raw-payload-retention` zera o
-- `raw_payload` com 14 dias. Ler só o payload faria o nome sumir em duas
-- semanas; por isso o nome ganha coluna própria, gravada no INSERT.
--
-- SÓ DDL, de propósito. `whatsapp_messages` tem ~3 M linhas / ~2 GB de heap e
-- nenhum índice em `message_type`: um backfill aqui dentro faria seq scan da
-- tabela inteira SEGURANDO o ACCESS EXCLUSIVE do ADD COLUMN até o COMMIT —
-- todo INSERT de webhook e todo SELECT do chat ficariam na fila. O backfill
-- é o script de operador `scripts/backfill-media-file-name.sql`, rodado à
-- parte, fora do pico, em lotes.
--
-- ORDEM DE DEPLOY:
--   1) esta migration (rápida: só catálogo);
--   2) scripts/backfill-media-file-name.sql, fora do pico;
--   3) KM;
--   4) merge/deploy do frontend (ele faz SELECT de `media_file_name`; sem a
--      coluna o PostgREST devolve 400 e a thread do chat fica vazia em todas
--      as orgs).
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- Rollback: supabase/migrations/rollback/20271108000100_whatsapp_messages_media_file_name.sql

BEGIN;

-- Curto: se houver fila no lock da tabela, falha rápido em vez de enfileirar
-- o tráfego do chat atrás do ALTER. Basta rodar de novo.
SET LOCAL lock_timeout = '3s';

-- Nullable, sem default: só catálogo, sem rewrite.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_file_name text;

COMMENT ON COLUMN public.whatsapp_messages.media_file_name IS
  'Nome original do arquivo de um documento, copiado do raw_payload no INSERT '
  '(sobrevive à retenção de 14 dias do raw_payload). NULL = desconhecido.';

-- Limpa um candidato a nome: tira caracteres de controle ASCII e os de
-- controle de direção bidi (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) —
-- sem isso `fatura<U+202E>fdp.exe` aparece como `faturaexe.pdf`. Vazio vira NULL.
CREATE OR REPLACE FUNCTION public.whatsapp_messages_clean_file_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        p_name,
        '[\x01-\x1F\x7F‎‏‪-‮⁦-⁩]',
        '',
        'g'
      )
    ),
    ''
  );
$$;

-- Expressão única, usada pelo trigger e pelo script de backfill.
CREATE OR REPLACE FUNCTION public.whatsapp_messages_extract_media_file_name(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT left(
    coalesce(
      public.whatsapp_messages_clean_file_name(p_payload->'content'->>'fileName'),
      public.whatsapp_messages_clean_file_name(p_payload->'content'->>'title'),
      public.whatsapp_messages_clean_file_name(p_payload->'document'->>'filename')
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

-- Funções de trigger/infra: ninguém chama por RPC.
REVOKE ALL ON FUNCTION public.whatsapp_messages_clean_file_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_messages_extract_media_file_name(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_messages_set_media_file_name() FROM PUBLIC, anon, authenticated;

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

COMMIT;
