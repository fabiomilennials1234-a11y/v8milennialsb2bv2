-- ROLLBACK pareado da 20270918000000_org_nova_nasce_com_funil_de_vendas.sql
-- (SCRUM-641). Desliga o seed de org nova. NÃO apaga funis já semeados em
-- orgs criadas enquanto o trigger esteve no ar — funil semeado é conteúdo da
-- org (renomeável/deletável pelo usuário), não estado do sistema.

DROP TRIGGER IF EXISTS trg_seed_default_funnel ON public.organizations;
DROP FUNCTION IF EXISTS public.fn_seed_default_funnel_for_org();
DROP FUNCTION IF EXISTS public.seed_default_sales_funnel(uuid);
