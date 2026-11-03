-- Rollback de 20271224000000_lista_fria_importar_e_disparar.sql
-- Apaga o registro dos pedidos de "Importar e Disparar". Não desfaz leads,
-- negócios nem planos de disparo que já saíram: esses são dados do cliente.
DROP FUNCTION IF EXISTS public.lista_fria_disparo_preparar(uuid, uuid, uuid, text, uuid[], integer, integer);
DROP TABLE IF EXISTS public.lista_fria_disparos;
