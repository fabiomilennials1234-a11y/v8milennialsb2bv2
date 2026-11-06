-- Rollback de 20271227020000_app_representantes_rotas.sql. Exportar as tabelas afetadas antes de executar.
-- ATENÇÃO: apaga o histórico de rotas. Exportar as tabelas antes de executar.
BEGIN;
DROP TABLE IF EXISTS public.rep_route_stops;
DROP TABLE IF EXISTS public.rep_routes;
DROP FUNCTION IF EXISTS public.mobile_route_sync(uuid, uuid, text, timestamptz, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.rep_route_team_orgs();
DELETE FROM public.feature_permissions WHERE key = 'rotas.view_team';
DELETE FROM public.mobile_op_log WHERE kind = 'route';
COMMIT;
