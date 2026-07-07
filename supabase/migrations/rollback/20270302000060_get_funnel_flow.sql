-- ROLLBACK de 20270302000060_get_funnel_flow.sql (issue #996)
--
-- Remove o leitor canônico de funil (SP-3) e seu helper puro. Readers sem
-- estado: dropar as funções basta. Os motores antigos get_funnel_health /
-- get_funnel_conversion (snapshots #987) seguem vivos e são o caminho de
-- rollback de leitura — nada a restaurar aqui.
--
-- Rollback só antes de qualquer consumidor SP-3 (#998+) apontar pra esta RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.get_funnel_flow(uuid, uuid, text, date, date, date);
DROP FUNCTION IF EXISTS public.fn_funnel_flow_step(text, integer, integer, integer);

COMMIT;
