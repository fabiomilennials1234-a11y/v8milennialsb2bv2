-- Rollback de 20270810150001_purgeable_group_media_fn.sql
--
-- Remove o seletor de candidatos à purga. Não desfaz deleções já executadas —
-- objeto apagado do Storage não volta por migration.

drop function if exists public.list_purgeable_media(text, int);
