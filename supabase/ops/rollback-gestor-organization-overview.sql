-- Rollback exclusivo da consulta nova; preservar schema private e tabelas.
BEGIN;
DROP FUNCTION IF EXISTS public.gestor_organization_overview();
DROP FUNCTION IF EXISTS private.gestor_organization_overview();
COMMIT;
