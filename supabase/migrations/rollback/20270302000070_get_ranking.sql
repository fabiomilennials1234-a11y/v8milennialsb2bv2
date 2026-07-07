-- ROLLBACK de 20270302000070_get_ranking.sql (issue #997)
--
-- Remove o leaderboard canônico de venda (SP-3). Puro reader, sem estado: dropar
-- a função basta. O motor antigo get_ranking_data (snapshot #987, ADR-0018) segue
-- vivo e é o caminho de rollback do pódio — nada a restaurar aqui.
--
-- Rollback só antes de qualquer consumidor SP-3 (#998+) apontar pra esta RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.get_ranking(uuid, text, date, date, date, uuid);

COMMIT;
