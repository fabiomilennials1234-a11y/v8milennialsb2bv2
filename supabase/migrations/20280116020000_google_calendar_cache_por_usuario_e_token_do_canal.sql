-- ════════════════════════════════════════════════════════════════════════════
-- Google Calendar: cache com chave por usuário + token do watch channel
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. google_calendar_events_cache: PRIMARY KEY (id) → PRIMARY KEY (user_id, id)
--
--    O id de evento do Google NÃO é global por tenant: um evento com
--    convidados aparece com o MESMO id na agenda de cada participante. Com a
--    chave só em `id`, o upsert `onConflict: "id"` do webhook de um
--    participante de outra org reescrevia `user_id`/`organization_id` da linha
--    — a linha "mudava de tenant" (some do dono, aparece para o outro via
--    cal_cache_select_own). Com (user_id, id), cada participante tem a sua
--    cópia; nenhum upsert de um usuário toca linha de outro.
--
--    Seguro em dados existentes: a chave antiga (id) já é única, então
--    (user_id, id) também é. Prod (2026-11-16): 648 linhas, 7 MB, nenhuma FK
--    apontando para a tabela, nenhuma função referenciando-a — a troca de PK
--    reconstrói um índice pequeno sob ACCESS EXCLUSIVE por milissegundos.
--
-- 2. google_calendar_watch_channels.channel_token_hash
--
--    O webhook é público (o Google não autentica o POST); hoje basta conhecer
--    um channel_id para disparar o processamento. O `token` do events/watch é
--    devolvido pelo Google em X-Goog-Channel-Token a cada notificação.
--    Guardamos só o SHA-256 (hex) do token: o dono lê a própria linha
--    (watch_channels_select_own), então o token em claro não fica no banco.
--    NULL = canal registrado antes desta mudança: o webhook o tolera só
--    enquanto não expira (expiration > now()). A renovação grava o hash do
--    canal novo; uma agenda parada deixa o legado expirar e ser recusado.
--
-- Ordem de deploy: ESTA migration antes das edge functions
-- google-calendar-webhook / google-calendar-events / google-calendar-callback
-- (o webhook passa a selecionar channel_token_hash e a fazer upsert em
-- (user_id, id)). Só schema, nenhum DML.
-- ════════════════════════════════════════════════════════════════════════════

-- Tabelas pequenas, mas a troca de PK pega ACCESS EXCLUSIVE: não enfileirar
-- escrita de produção atrás de uma transação longa.
SET LOCAL lock_timeout = '3s';

-- 1. Chave por usuário ────────────────────────────────────────────────────────
ALTER TABLE public.google_calendar_events_cache
  DROP CONSTRAINT google_calendar_events_cache_pkey;

ALTER TABLE public.google_calendar_events_cache
  ADD CONSTRAINT google_calendar_events_cache_pkey PRIMARY KEY (user_id, id);

-- idx_cal_cache_user (user_id) fica redundante com o prefixo da PK nova.
DROP INDEX IF EXISTS public.idx_cal_cache_user;

-- Buscas por id puro (DELETE/PATCH pelo id do evento) continuam indexadas.
CREATE INDEX IF NOT EXISTS idx_cal_cache_event_id
  ON public.google_calendar_events_cache USING btree (id);

-- 2. Hash do token do canal ───────────────────────────────────────────────────
ALTER TABLE public.google_calendar_watch_channels
  ADD COLUMN IF NOT EXISTS channel_token_hash text;

COMMENT ON COLUMN public.google_calendar_watch_channels.channel_token_hash IS
  'SHA-256 (hex) do token enviado em events/watch; o webhook compara com X-Goog-Channel-Token. NULL = canal legado, tolerado até a renovação.';
