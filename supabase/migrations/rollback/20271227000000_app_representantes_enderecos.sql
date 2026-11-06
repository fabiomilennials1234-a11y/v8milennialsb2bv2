-- Rollback de 20271227000000_app_representantes_enderecos.sql. Exportar as tabelas afetadas antes de executar.
-- ATENÇÃO: apaga os endereços. Exportar as tabelas antes de executar.
BEGIN;
DROP FUNCTION IF EXISTS public.org_address_readiness(uuid, numeric);
DELETE FROM public.feature_permissions WHERE key = 'leads.edit_address';
DROP FUNCTION IF EXISTS public.lead_address_prune_events(interval);
DROP FUNCTION IF EXISTS public.lead_address_prune_op_log(interval);
DROP FUNCTION IF EXISTS public.lead_address_expire_exhausted();
DROP FUNCTION IF EXISTS public.lead_address_mark_geocode_failure(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.lead_address_apply_geocode(uuid, text, double precision, double precision, text, text, numeric);
DROP FUNCTION IF EXISTS public.lead_address_claim_pending(integer, interval, interval);
DROP FUNCTION IF EXISTS public.lead_address_retry_geocode(uuid);
DROP FUNCTION IF EXISTS public.lead_address_delete(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_address_set_pin(uuid, double precision, double precision);
DROP FUNCTION IF EXISTS public.lead_address_upsert(uuid, jsonb, uuid, timestamptz, boolean, uuid);
DROP FUNCTION IF EXISTS public.lead_address_authorize(uuid);
DROP TABLE IF EXISTS public.mobile_op_log;
DROP TABLE IF EXISTS public.lead_address_events;
DROP TABLE IF EXISTS public.lead_addresses;
DROP FUNCTION IF EXISTS public.lead_addresses_before_write();
COMMIT;
