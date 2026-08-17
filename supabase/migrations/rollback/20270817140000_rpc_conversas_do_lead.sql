-- Rollback de 20270817140000_rpc_conversas_do_lead.sql
--
-- Derrubar a função tira o dado do seletor de Conversa do Lead. Nada mais a
-- consome — se a UI já estiver em produção, ela passa a receber erro de RPC
-- inexistente, então derrube a UI antes ou junto.

DROP FUNCTION IF EXISTS public.get_conversas_do_lead(text);
