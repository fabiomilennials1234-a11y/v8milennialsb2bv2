-- ROLLBACK de 20271226000000_boas_vindas_semana.sql
--
-- Remove a RPC, a função interna e o caderno de "já viu". Perde só o histórico
-- de quem viu a abertura de qual semana — nada de negócio.
DROP FUNCTION IF EXISTS public.boas_vindas_semana_reivindicar(uuid);
DROP FUNCTION IF EXISTS public.boas_vindas_semana_resumo(uuid, date);
DROP TABLE IF EXISTS public.boas_vindas_semana_vistas;
