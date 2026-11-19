-- Rollback de 20280121010000_cobranca_ordem_das_colunas.sql
-- Remove as RPCs. A ordem das colunas que a equipe já escolheu fica como está.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION public.cobranca_coluna_mover_ordem(uuid, integer);
DROP FUNCTION private.cobranca_coluna_mover_ordem(uuid, uuid, integer);

COMMIT;
