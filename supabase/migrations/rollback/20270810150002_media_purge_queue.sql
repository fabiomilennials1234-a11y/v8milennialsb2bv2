-- Rollback de 20270810150002_media_purge_queue.sql
--
-- Não desfaz deleções: objeto removido do Storage não volta. Preserve a tabela
-- se quiser manter a trilha do que foi apagado — o DROP abaixo é opcional e
-- destrói essa auditoria.

drop function if exists public.mark_purged(text[]);
drop function if exists public.claim_purge_batch(text, int);
drop table if exists public.media_purge_queue;
