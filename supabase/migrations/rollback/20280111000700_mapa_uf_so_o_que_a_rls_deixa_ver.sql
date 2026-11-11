-- Rollback de 20280111000700_mapa_uf_so_o_que_a_rls_deixa_ver.sql
--
-- Tira o espelho da RLS e o teto do drawer de get_leads_by_uf e get_uf_heatmap,
-- pelo mesmo caminho cirúrgico (corpo vivo, troca só dos trechos): em prod,
-- private.*, a trava JRTex, a regra de acesso de 20280111000500 e a troca de
-- 20280111000800 (se aplicada) continuam. Reconhece as duas variantes do
-- espelho (com e sem o ramo da RioFix). Volta o defeito: membro sem
-- leads.view_all volta a ler nome, empresa e telefone da UF inteira, e p_limit
-- volta a não ter teto.
--
-- O EXECUTE de PUBLIC e anon volta junto, para o estado ficar idêntico ao de
-- antes. Se a ideia é só desfazer o espelho, pule os dois GRANT do fim.

DO $volta$
DECLARE
  c_marca constant text := 'Só o que quem chama vê na /leads (20280111000700)';
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
  v_variante text;
  v_sig regprocedure;
  v_def text;
  v_antigos text[];
  v_novos text[];
  v_casou boolean;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure,
    'public.get_uf_heatmap(uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF position(c_marca IN v_def) = 0 THEN
      RAISE NOTICE '% não tem o espelho de 20280111000700 — nada a desfazer', v_sig;
      CONTINUE;
    END IF;

    v_casou := false;
    FOREACH v_variante IN ARRAY ARRAY[c_espelho || c_riofix, c_espelho || c_fecha] LOOP
      IF v_sig = 'public.get_leads_by_uf(character,integer,uuid)'::regprocedure THEN
        v_antigos := ARRAY[
          E'AND l.deleted_at IS NULL AND l.uf = p_uf\n',
          '  LIMIT p_limit;'
        ];
        v_novos := ARRAY[
          'AND l.deleted_at IS NULL AND l.uf = p_uf' || v_variante || E'\n',
          c_teto
        ];
      ELSE
        v_antigos := ARRAY[
          'AND l.deleted_at IS NULL AND l.uf IS NULL;',
          E'AND l.deleted_at IS NULL AND l.uf IS NOT NULL\n'
        ];
        v_novos := ARRAY[
          'AND l.deleted_at IS NULL AND l.uf IS NULL' || v_variante || ';',
          'AND l.deleted_at IS NULL AND l.uf IS NOT NULL' || v_variante || E'\n'
        ];
      END IF;

      v_casou := true;
      FOR i IN 1 .. array_length(v_novos, 1) LOOP
        IF (length(v_def) - length(replace(v_def, v_novos[i], ''))) / length(v_novos[i]) <> 1 THEN
          v_casou := false;
        END IF;
      END LOOP;
      IF v_casou THEN
        FOR i IN 1 .. array_length(v_novos, 1) LOOP
          v_def := replace(v_def, v_novos[i], v_antigos[i]);
        END LOOP;
        EXECUTE v_def;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_casou THEN
      RAISE EXCEPTION '% tem a marca de 20280111000700, mas não o texto que ela gravou — revise à mão', v_sig;
    END IF;
  END LOOP;
END
$volta$;

GRANT EXECUTE ON FUNCTION public.get_leads_by_uf(character, integer, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_uf_heatmap(uuid) TO PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
