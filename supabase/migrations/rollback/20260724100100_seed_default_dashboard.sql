-- ROLLBACK de 20260724100100_seed_default_dashboard.sql (#1207)
--
-- Ordem de reversão: PRIMEIRO este, depois o 20260724100000 (célula legada) —
-- o painel semeado contém células legadas que dependem daquele schema.
--
-- ⚠ DESTRUTIVO E IRREVERSÍVEL PARA CONFIGURAÇÃO DO CLIENTE.
-- O bloco 3 apaga páginas/widgets de TV. Se alguma org já tiver editado o painel
-- semeado, a edição vai junto — não há como distinguir "semeado" de "semeado e
-- depois ajustado". Por isso ele está COMENTADO por padrão: reverter o mecanismo
-- (função + gatilho) é seguro e não precisa apagar parede nenhuma. Descomente só
-- com decisão explícita de descartar a configuração.

-- 1. Gatilho do flip da flag de rollout.
DROP TRIGGER IF EXISTS trg_seed_dashboard_on_flag_enabled ON public.organizations;
DROP FUNCTION IF EXISTS public.fn_seed_dashboard_on_flag_enabled();

-- 2. As funções de semeadura — wrapper de autorização antes do corpo.
DROP FUNCTION IF EXISTS public.fn_seed_default_dashboard(uuid);
DROP FUNCTION IF EXISTS public._fn_seed_default_dashboard_unchecked(uuid);

-- 3. Painéis semeados — DESCOMENTE SÓ COM DECISÃO EXPLÍCITA (ver aviso acima).
--    Widgets caem por ON DELETE CASCADE do page_id.
-- DELETE FROM public.dashboard_pages
--  WHERE surface = 'tv'
--    AND title IN ('Fechamento', 'Time e topo de funil');
