-- ROLLBACK de 20280129000100_importacao_regras_de_etiqueta_grants.sql
-- Devolve a authenticated o que o default privilege do schema dava (arwdDxtm).
BEGIN;
SET LOCAL lock_timeout = '3s';

GRANT ALL ON public.import_tag_rules TO authenticated;

COMMIT;
