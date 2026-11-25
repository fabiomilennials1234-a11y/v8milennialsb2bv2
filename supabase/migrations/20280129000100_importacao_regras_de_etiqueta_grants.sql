-- import_tag_rules: authenticated fica com SELECT/INSERT/UPDATE/DELETE e nada mais.
--
-- A 20280129000000 fazia REVOKE de PUBLIC/anon e GRANT dos quatro, mas o default
-- privilege do schema public já tinha dado TUDO a authenticated na criação
-- (arwdDxtm, medido em prod em 25/11/2026): TRUNCATE, REFERENCES, TRIGGER e
-- MAINTAIN sobravam. TRUNCATE não passa por RLS. Mesmo padrão de cobranca_titulos.
--
-- Rollback: rollback/20280129000100_importacao_regras_de_etiqueta_grants.sql

BEGIN;
SET LOCAL lock_timeout = '3s';

REVOKE ALL ON public.import_tag_rules FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_tag_rules TO authenticated;

COMMIT;
