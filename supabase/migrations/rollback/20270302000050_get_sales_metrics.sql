-- ROLLBACK de 20270302000050_get_sales_metrics.sql (issue #995)
--
-- Remove o leitor canônico de venda (SP-3). Puro reader, sem estado: dropar a
-- função basta. O motor antigo get_dashboard_metrics (snapshot #987) segue vivo
-- e é o caminho de rollback de leitura — nada a restaurar aqui.
--
-- Rollback só antes de qualquer consumidor SP-3 (#998+) apontar pra esta RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid);

COMMIT;
