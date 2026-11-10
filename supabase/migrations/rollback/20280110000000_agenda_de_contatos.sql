-- Rollback de 20280110000000_agenda_de_contatos.sql
-- Remove a agenda de contatos inteira. 🔴 Apaga as agendas gravadas: exporte
-- `public.agenda_contatos` antes se houver dado a preservar.

DROP FUNCTION IF EXISTS public.agenda_contato_reabrir(uuid);
DROP FUNCTION IF EXISTS public.agenda_contato_concluir(uuid);
DROP FUNCTION IF EXISTS public.agenda_contato_marcar(uuid, uuid, date, text, uuid);
DROP FUNCTION IF EXISTS public.get_agenda_contatos_resumo(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_agenda_contatos(uuid, boolean, integer);
DROP TABLE IF EXISTS public.agenda_contatos;
DROP FUNCTION IF EXISTS public.agenda_contatos_hoje(uuid);
DROP FUNCTION IF EXISTS public.agenda_contatos_imutaveis();
