-- rollback/20280120000000_setores_fundacao.sql
--
-- Desfaz a fundação de Setores (fase 1). Remove policies, triggers, funções e
-- tabelas, nessa ordem. Os dados de setor (sectors, sector_members,
-- lead_sectors, pipeline_sectors) são PERDIDOS: exporte antes se a org já
-- usava setores.
--
-- Efeito de segurança: ao remover as policies RESTRICTIVE, qualquer org que
-- estava em modo 2+ volta a mostrar a todos os membros o que as policies
-- antigas permitem (por exemplo, leads.view_all mostra a org inteira).

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS sector_supervisor_leads_update          ON public.leads;
DROP POLICY IF EXISTS sector_supervisor_leads_select          ON public.leads;
DROP POLICY IF EXISTS sector_scope_pipeline_entries_select    ON public.pipeline_entries;
DROP POLICY IF EXISTS sector_scope_pipelines_select           ON public.pipelines;
DROP POLICY IF EXISTS sector_scope_leads_delete               ON public.leads;
DROP POLICY IF EXISTS sector_scope_leads_update               ON public.leads;
DROP POLICY IF EXISTS sector_scope_leads_select               ON public.leads;

DROP TRIGGER IF EXISTS trg_leads_inherit_creator_sector ON public.leads;

DROP FUNCTION IF EXISTS public.sectors_backfill(uuid, boolean);

DROP TABLE IF EXISTS public.pipeline_sectors;
DROP TABLE IF EXISTS public.lead_sectors;
DROP TABLE IF EXISTS public.sector_members;
DROP TABLE IF EXISTS public.sectors;

DROP FUNCTION IF EXISTS private.leads_inherit_creator_sector();
DROP FUNCTION IF EXISTS private.sectors_guard_default_delete();
DROP FUNCTION IF EXISTS private.sectors_first_is_default();
DROP FUNCTION IF EXISTS private.sectors_check_lead_org();
DROP FUNCTION IF EXISTS private.sectors_check_pipeline_org();
DROP FUNCTION IF EXISTS private.sectors_check_member_org();
DROP FUNCTION IF EXISTS private.sectors_check_sector_org();
DROP VIEW IF EXISTS private.lead_sector_map;
DROP FUNCTION IF EXISTS private.xact_has_writes();
DROP FUNCTION IF EXISTS private.my_sector_pipeline_ids();
DROP FUNCTION IF EXISTS private.sector_supervisor_orgs_m2();
DROP FUNCTION IF EXISTS private.sector_supervisor_orgs_m1();
DROP FUNCTION IF EXISTS private.my_default_supervised_orgs();
DROP FUNCTION IF EXISTS private.my_default_sector_orgs();
DROP FUNCTION IF EXISTS private.lead_in_sectors(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS private.sector_supervisor_orgs();
DROP FUNCTION IF EXISTS private.sector_scoped_orgs();
DROP FUNCTION IF EXISTS private.my_supervised_sector_ids();
DROP FUNCTION IF EXISTS private.my_sector_ids();

COMMIT;
