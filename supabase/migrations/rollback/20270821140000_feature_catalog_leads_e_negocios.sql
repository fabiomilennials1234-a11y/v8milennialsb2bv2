-- ===========================================================================
-- ROLLBACK — 20270821140000_feature_catalog_leads_e_negocios.sql (SCRUM-409)
-- ===========================================================================
-- Devolve os dois valores medidos em produção em 2026-08-21.
--
-- ⚠ Reverter REINTRODUZ os dois defeitos: a tela de plano volta a chamar Leads
-- de "Combustivel", e a sidebar volta a anunciar `/negocios`, que não tem rota
-- nem guard — o que `tests/unit/route-feature-map.test.ts` reprova.
-- ===========================================================================

UPDATE public.feature_catalog
   SET name = 'Combustivel (Leads)',
       display_name = 'Combustivel'
 WHERE key = 'leads';

UPDATE public.feature_catalog
   SET sidebar_path = '/negocios'
 WHERE key = 'deals';
