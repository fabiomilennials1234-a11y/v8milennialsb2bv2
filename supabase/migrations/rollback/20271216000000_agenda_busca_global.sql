-- ROLLBACK de 20271216000000_agenda_busca_global.sql
-- Só remove funções novas; nenhuma tabela/coluna/dado é tocado.
-- O front trata PGRST202 (função ausente) como "busca indisponível".
DROP FUNCTION IF EXISTS public.search_agenda_events(uuid, text, integer);
DROP FUNCTION IF EXISTS public.agenda_search_fold(text);
