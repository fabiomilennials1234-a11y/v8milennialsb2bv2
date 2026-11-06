-- Rollback de 20271227030000_app_representantes_papeis.sql. Exportar as tabelas afetadas antes de executar.
-- ATENÇÃO: apaga os planos do dia. Exportar as tabelas antes de executar. Produtos criados NÃO são apagados.
BEGIN;
DROP POLICY lead_addresses_select ON public.lead_addresses;
CREATE POLICY lead_addresses_select ON public.lead_addresses FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids())
         AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_addresses.lead_id));
DROP FUNCTION IF EXISTS public.mobile_plan_save(uuid, uuid, uuid, uuid, date, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.rep_plan_address_visible(uuid);
DROP FUNCTION IF EXISTS public.mobile_product_save(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.mobile_me();
DROP TABLE IF EXISTS public.rep_day_plan_stops;
DROP TABLE IF EXISTS public.rep_day_plans;
DELETE FROM public.mobile_op_log WHERE kind IN ('product', 'plan');
COMMIT;
