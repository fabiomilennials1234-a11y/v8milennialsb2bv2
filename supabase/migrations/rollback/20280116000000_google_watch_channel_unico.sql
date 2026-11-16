-- Rollback de 20280116000000_google_watch_channel_unico.sql
--
-- ATENÇÃO: rodar isto com as edge functions novas no ar quebra a renovação
-- (registerWatchChannel chama replace_google_watch_channel). Reverta antes o
-- deploy de google-calendar-webhook/callback. Sem o índice único parcial, a
-- multiplicação de canais do incidente de 2026-11-16 volta a ser possível.
--
-- A migration é só schema (nenhum DML), então não há dado a restaurar.

DROP FUNCTION IF EXISTS public.replace_google_watch_channel(uuid, uuid, text, text, text, timestamptz, text);
DROP INDEX IF EXISTS public.uq_watch_channels_active_user_calendar;
