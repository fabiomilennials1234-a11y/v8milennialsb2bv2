-- ROLLBACK de 20270302000071_get_commission_ledger.sql (issue #997)
--
-- Remove o leitor de comissão-como-ledger (SP-3). Puro reader, sem estado:
-- dropar a função basta. O cálculo on-the-fly antigo (useCommissions) segue
-- vivo e é o caminho de rollback da leitura de comissão — nada a restaurar aqui.
-- A projeção em commissions (#994) NÃO é tocada por este rollback.
--
-- Rollback só antes de qualquer consumidor SP-3 (#998+) apontar pra esta RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.get_commission_ledger(uuid, text, date, date, date, uuid);

COMMIT;
