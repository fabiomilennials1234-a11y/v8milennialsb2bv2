-- Rollback de 20280116010000_google_calendar_oauth_nonce.sql
--
-- Só reverter junto com o rollback de google-calendar-connect e
-- google-calendar-callback: sem a tabela, o connect novo responde 503 e o
-- callback novo recusa todo state.

DROP FUNCTION IF EXISTS public.google_calendar_consume_oauth_nonce(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.google_calendar_oauth_nonces;
