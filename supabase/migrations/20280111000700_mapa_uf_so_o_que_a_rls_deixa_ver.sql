-- 20280111000700_mapa_uf_so_o_que_a_rls_deixa_ver.sql
--
-- Mapa de clientes: o relatório do estado (get_leads_by_uf, o drawer) e as
-- contagens do mapa (get_uf_heatmap) passam a valer só sobre os leads que quem
-- chama vê na /leads.
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- As duas são SECURITY DEFINER e leem os leads como postgres, que tem
-- BYPASSRLS: a policy de SELECT de leads (leads_select_by_responsibility_and_
-- permissions) não vale aqui dentro. Em prod, private.leads aplica só o regime
-- dono estrito. Qualquer membro ATIVO, mesmo sem leads.view_all, recebia nome,
-- empresa e telefone de todos os leads da UF, e p_limit não tinha teto (NULL
-- vira LIMIT ALL). Medido em prod em 11/11: 10 membros sem view_all em 5 orgs
-- não estritas alcançavam 6.493 leads que a RLS esconde deles — 1.378 só
-- clicando nos estados, com o padrão de 60. Na Alamaster, a RLS mostra 0 leads
-- a um membro; o drawer mostrava 167.
--
-- ── A correção ───────────────────────────────────────────────────────────
-- 1. O WHERE das duas ganha o espelho das policies PERMISSIVAS de SELECT de
--    public.leads, com os mesmos helpers e os mesmos initplans: master,
--    gestor de portfólio, admin, leads.view_all, responsável, sem responsável,
--    subordinados, co-dono e funil; service_role passa (BYPASSRLS, como em
--    assert_org_access). Onde existe (prod), entra também o ramo do balcão da
--    RioFix (riofix_balcao_shared_read). A RESTRICTIVE do regime dono estrito
--    continua vindo de private.leads — e o $verify$ confere isso.
--    Prova em prod (11/11, só leitura): para 57 atores — os 37 membros sem
--    view_all, admins, gestores, master, balcão da RioFix e service_role — o
--    predicado devolve, UF a UF, os mesmos ids que a RLS de public.leads
--    entrega ao papel do ator (mesma contagem, mesmo md5 dos ids). Uma segunda
--    varredura, com 556 atores (todos os pares de team_members, gestores e
--    masters), deu 0 divergências.
-- 2. Teto do drawer: LIMIT LEAST(COALESCE(p_limit, 60), 60). O front mostra
--    tudo o que recebe e nunca passa p_limit (useUfMap.ts): nada muda na tela.
-- 3. EXECUTE sai de PUBLIC e anon. O corpo já recusa anon (assert_org_access),
--    mas o grant só entrega superfície — ver 20270811190000.
--
-- ── Cirúrgica de propósito ───────────────────────────────────────────────
-- Mesmo caminho de 20280111000500: lê o corpo VIVO (pg_get_functiondef), troca
-- só os trechos abaixo e reaplica. Em prod preserva private.*, a trava JRTex e
-- a regra de acesso de 20280111000500; num banco novo, o corpo do repo.
-- Assinatura, SECURITY DEFINER e search_path ficam como estão.
--
-- As âncoras são só a linha do WHERE (sem o ORDER BY e o GROUP BY) e o
-- LIMIT: 20280111000800 mexe nos mesmos corpos (JOIN do caderno antes do
-- WHERE) e as duas aplicam em qualquer ordem, chegando ao mesmo corpo final.
--
-- Falha fechada: cada trecho tem de aparecer exatamente 1 vez no corpo vivo, e
-- a trava JRTex e o private.leads têm de sobreviver à troca. Idempotente: corpo
-- que já tem o espelho só avisa (a marca é a 1ª linha do comentário dele).
--
-- ── O espelho tem dono ───────────────────────────────────────────────────
-- Mudou uma policy de SELECT de leads? Mude este espelho junto. O $verify$
-- aborta se aparecer policy permissiva que ele não cobre, ou RESTRICTIVE além
-- da do regime dono estrito, e supabase/tests/mapa_uf_espelho_rls_test.sql
-- compara, ator a ator e ramo a ramo, o drawer com a RLS (set_eq).
--
-- ROLLBACK: supabase/migrations/rollback/20280111000700_mapa_uf_so_o_que_a_rls_deixa_ver.sql

DO $migra$
DECLARE
  c_marca constant text := 'Só o que quem chama vê na /leads (20280111000700)';
  -- O espelho das policies PERMISSIVAS de SELECT de public.leads.
  c_espelho constant text := $espelho$
    -- Só o que quem chama vê na /leads (20280111000700): espelho das policies
    -- PERMISSIVAS de SELECT de public.leads, com os mesmos helpers. Em prod, a
    -- RESTRICTIVE do regime dono estrito já vem do próprio private.leads.
    AND (
      -- backend: service_role tem BYPASSRLS (e assert_org_access o deixa passar)
      COALESCE((SELECT auth.role()), '') = 'service_role'
      -- master_select_all_leads / master_all_leads
      OR (SELECT public.is_master_user())
      -- leads_select_by_responsibility_and_permissions
      OR (
        l.organization_id IN (SELECT public.get_my_organization_ids())
        AND (
          (SELECT public.is_user_admin())
          OR l.organization_id IN (SELECT public.get_my_gestor_organization_ids())
          OR (SELECT public.has_feature_permission('leads.view_all'))
          OR l.organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
          OR l.pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
          OR l.sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
          OR l.sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
          OR l.closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
          OR (
            l.sdr_id IS NULL AND l.closer_id IS NULL
            AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
          )
          OR (
            (SELECT public.user_has_org_permission('see_subordinates_cards'))
            AND (
              l.sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
              OR l.closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
            )
          )
          OR (
            (SELECT public.rls_my_has_co_ownership())
            AND public.rls_lead_co_owned(l.id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
          )
          OR (
            cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
            AND public.rls_lead_in_my_pipes(l.id, (SELECT public.rls_my_team_member_ids(true)))
          )
        )
      )$espelho$;
  -- riofix_balcao_shared_read: só entra onde as funções dela existem (prod).
  c_riofix constant text := $riofix$
      -- riofix_balcao_shared_read (só existe em prod: balcão da RioFix)
      OR (
        (SELECT private.riofix_balcao_current_scope()) IS NOT NULL
        AND l.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid
        AND private.riofix_balcao_caller_lead(l.organization_id, l.id)
      )
    )$riofix$;
  c_fecha constant text := E'\n    )';
  c_teto constant text :=
    E'  -- Teto do drawer (20280111000700): o front mostra até 60 e nunca passa\n'
    || E'  -- p_limit; NULL ou valor maior não abrem mais a UF inteira.\n'
    || '  LIMIT LEAST(COALESCE(p_limit, 60), 60);';
  v_espelho text;
  v_sig regprocedure;
  v_def text;
  v_antigos text[];
  v_novos text[];
  v_n int;
  v_jrtex boolean;
  v_private boolean;
BEGIN
  v_espelho := c_espelho || CASE
    WHEN to_regprocedure('private.riofix_balcao_current_scope()') IS NOT NULL
     AND to_regprocedure('private.riofix_balcao_caller_lead(uuid,uuid)') IS NOT NULL
    THEN c_riofix ELSE c_fecha END;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure,
    'public.get_uf_heatmap(uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF position(c_marca IN v_def) > 0 THEN
      RAISE NOTICE '% já tem o espelho da RLS — nada a fazer', v_sig;
      CONTINUE;
    END IF;
    IF position('PERFORM public.assert_org_access(v_org_id);' IN v_def) = 0 THEN
      RAISE EXCEPTION '% não tem a regra de acesso de 20280111000500 — aplique-a antes', v_sig;
    END IF;

    IF v_sig = 'public.get_leads_by_uf(character,integer,uuid)'::regprocedure THEN
      v_antigos := ARRAY[
        E'AND l.deleted_at IS NULL AND l.uf = p_uf\n',
        '  LIMIT p_limit;'
      ];
      v_novos := ARRAY[
        'AND l.deleted_at IS NULL AND l.uf = p_uf' || v_espelho || E'\n',
        c_teto
      ];
    ELSE
      v_antigos := ARRAY[
        'AND l.deleted_at IS NULL AND l.uf IS NULL;',
        E'AND l.deleted_at IS NULL AND l.uf IS NOT NULL\n'
      ];
      v_novos := ARRAY[
        'AND l.deleted_at IS NULL AND l.uf IS NULL' || v_espelho || ';',
        'AND l.deleted_at IS NULL AND l.uf IS NOT NULL' || v_espelho || E'\n'
      ];
    END IF;

    -- Todos os trechos conferidos no corpo ORIGINAL antes de trocar qualquer um.
    FOR i IN 1 .. array_length(v_antigos, 1) LOOP
      v_n := (length(v_def) - length(replace(v_def, v_antigos[i], ''))) / length(v_antigos[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%: o trecho % aparece % vez(es), e não 1 — o corpo mudou; revise antes de aplicar',
          v_sig, i, v_n;
      END IF;
    END LOOP;

    v_jrtex := position('private.jrtex_pipeline_scoped()' IN v_def) > 0;
    v_private := position('FROM private.leads l' IN v_def) > 0;
    FOR i IN 1 .. array_length(v_antigos, 1) LOOP
      v_def := replace(v_def, v_antigos[i], v_novos[i]);
    END LOOP;
    EXECUTE v_def;

    -- O que o corpo vivo tinha e a troca não pode levar embora.
    v_def := pg_get_functiondef(v_sig);
    IF (position('private.jrtex_pipeline_scoped()' IN v_def) > 0) IS DISTINCT FROM v_jrtex
       OR (position('FROM private.leads l' IN v_def) > 0) IS DISTINCT FROM v_private THEN
      RAISE EXCEPTION '% perdeu a trava JRTex ou o private.leads na troca', v_sig;
    END IF;
  END LOOP;
END
$migra$;

-- authenticated e service_role têm grant próprio e continuam executando.
REVOKE EXECUTE ON FUNCTION public.get_leads_by_uf(character, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_uf_heatmap(uuid) FROM PUBLIC, anon;

-- Prova: as duas têm o espelho, continuam SECURITY DEFINER e com a regra de
-- acesso; o drawer tem teto; as policies de SELECT de leads são as que o
-- espelho cobre — as permissivas, pelo próprio espelho; a RESTRICTIVE do regime
-- dono estrito, por private.leads.
DO $verify$
DECLARE
  v_sig regprocedure;
  v_def text;
  v_riofix boolean;
  v_estrito boolean;
  v_view text;
  v_sem_ramo text;
BEGIN
  SELECT string_agg(p.polname, ', ' ORDER BY p.polname) INTO v_sem_ramo
    FROM pg_policy p
   WHERE p.polrelid = 'public.leads'::regclass
     AND p.polpermissive
     AND p.polcmd IN ('r', '*')
     AND (0 = ANY (p.polroles) OR 'authenticated'::regrole::oid = ANY (p.polroles))
     AND p.polname NOT IN ('master_all_leads', 'master_select_all_leads',
                           'leads_select_by_responsibility_and_permissions',
                           'riofix_balcao_shared_read');
  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'policy permissiva de SELECT em leads sem ramo no espelho: % — atualize 20280111000700', v_sem_ramo;
  END IF;

  SELECT string_agg(p.polname, ', ' ORDER BY p.polname) INTO v_sem_ramo
    FROM pg_policy p
   WHERE p.polrelid = 'public.leads'::regclass
     AND NOT p.polpermissive
     AND p.polcmd IN ('r', '*')
     AND (0 = ANY (p.polroles) OR 'authenticated'::regrole::oid = ANY (p.polroles))
     AND p.polname <> 'strict_owner_leads_select';
  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'policy RESTRICTIVE de SELECT em leads que o mapa não aplica: % — atualize 20280111000700', v_sem_ramo;
  END IF;

  -- A RESTRICTIVE do regime estrito vale no mapa porque ele lê private.leads,
  -- que aplica o mesmo predicado.
  v_estrito := EXISTS (SELECT 1 FROM pg_policy
                        WHERE polrelid = 'public.leads'::regclass
                          AND polname = 'strict_owner_leads_select');
  IF v_estrito THEN
    v_view := CASE WHEN to_regclass('private.leads') IS NULL THEN ''
                   ELSE pg_get_viewdef('private.leads'::regclass) END;
    IF position('strict_lead_member_orgs()' IN v_view) = 0
       OR position('strict_lead_is_owned(' IN v_view) = 0 THEN
      RAISE EXCEPTION 'regime dono estrito ligado, mas private.leads não aplica o predicado dele';
    END IF;
  END IF;

  v_riofix := EXISTS (SELECT 1 FROM pg_policy
                       WHERE polrelid = 'public.leads'::regclass
                         AND polname = 'riofix_balcao_shared_read');

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure,
    'public.get_uf_heatmap(uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sig) THEN
      RAISE EXCEPTION '% deixou de ser SECURITY DEFINER', v_sig;
    END IF;
    IF position('Só o que quem chama vê na /leads (20280111000700)' IN v_def) = 0
       OR position('PERFORM public.assert_org_access(v_org_id);' IN v_def) = 0
       OR position('public.rls_lead_in_my_pipes(l.id, (SELECT public.rls_my_team_member_ids(true)))' IN v_def) = 0 THEN
      RAISE EXCEPTION '% não ficou com o espelho da RLS', v_sig;
    END IF;
    IF v_estrito AND position('FROM private.leads l' IN v_def) = 0 THEN
      RAISE EXCEPTION '% lê leads sem passar por private.leads, mas o regime dono estrito está ligado', v_sig;
    END IF;
    IF v_riofix AND position('private.riofix_balcao_caller_lead(l.organization_id, l.id)' IN v_def) = 0 THEN
      RAISE EXCEPTION '% sem o ramo da RioFix, mas a policy riofix_balcao_shared_read existe', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ainda executa %', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig::oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_sig::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated ou service_role perdeu EXECUTE em %', v_sig;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure);
  IF position('LIMIT p_limit;' IN v_def) > 0
     OR position('LIMIT LEAST(COALESCE(p_limit, 60), 60);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_leads_by_uf ficou sem o teto de 60';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
