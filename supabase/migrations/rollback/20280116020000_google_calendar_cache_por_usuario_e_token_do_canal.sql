-- Rollback de 20280116020000_google_calendar_cache_por_usuario_e_token_do_canal.sql
--
-- ATENÇÃO: reverta ANTES o deploy de google-calendar-webhook / -events /
-- -callback. As versões novas fazem upsert com onConflict "user_id,id" (exige
-- a PK composta) e o webhook seleciona channel_token_hash.
--
-- A volta para PRIMARY KEY (id) FALHA se já houver o mesmo evento do Google
-- em cache para mais de um usuário (o caso que a migration passou a permitir).
-- De propósito: decidir qual cópia fica é operação explícita, nunca escondida
-- em rollback. Para listar as duplicatas:
--   SELECT id, count(*) FROM public.google_calendar_events_cache
--   GROUP BY id HAVING count(*) > 1;
-- O cache é reconstruível (o GET de google-calendar-events re-sincroniza), então
-- apagar as cópias excedentes não perde dado de negócio.

ALTER TABLE public.google_calendar_watch_channels
  DROP COLUMN IF EXISTS channel_token_hash;

DROP INDEX IF EXISTS public.idx_cal_cache_event_id;

ALTER TABLE public.google_calendar_events_cache
  DROP CONSTRAINT google_calendar_events_cache_pkey;

ALTER TABLE public.google_calendar_events_cache
  ADD CONSTRAINT google_calendar_events_cache_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS idx_cal_cache_user
  ON public.google_calendar_events_cache USING btree (user_id);
