-- ROLLBACK de 20280129000000_importacao_regras_de_etiqueta.sql
-- Apaga o mapa coluna→etiqueta. Os leads já etiquetados ficam como estão: a
-- tabela só guardava a escolha para a próxima importação.
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS public.import_tag_rules;

COMMIT;
