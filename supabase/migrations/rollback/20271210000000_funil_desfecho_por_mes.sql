-- Rollback de 20271210000000_funil_desfecho_por_mes (Chamado 172ef046).
--
-- Remove a RPC da pilha de Ganhos/Perdidos. Pode rodar sem reverter o front:
-- sem a função, `useFunilDesfechoPorMes` recebe erro, a pilha volta ao modo
-- parcial (conta o carregado e se declara com "+" e "≥") e o board segue de pé.
-- Nenhum dado é tocado — a migration só criou a função.

BEGIN;
SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.get_funil_desfecho_por_mes(uuid, uuid, text);

COMMIT;
