-- Rollback de 20280111000500_mapa_uf_acesso_pela_regra_da_plataforma.sql
--
-- Devolve a resolução da org de get_uf_heatmap e get_leads_by_uf para
-- resolve_org_for_rpc, pelo mesmo caminho cirúrgico (corpo vivo, troca só das
-- linhas): em prod, private.* e a trava JRTex continuam. Volta o defeito — o
-- master e o gestor recebem o mapa vazio, e o membro desativado volta a ler.

DO $volta$
DECLARE
  v_sig regprocedure;
  v_def text;
  c_novo constant text :=
    E'  -- Org pela regra da plataforma (20280111000500): membro ATIVO, gestor de\n'
    || E'  -- portfólio ou master. Sem org explícita, a 1ª de quem chama, como antes.\n'
    || E'  v_org_id := COALESCE(p_org_id, resolve_org_for_rpc(NULL));\n'
    || E'  PERFORM public.assert_org_access(v_org_id);\n'
    || '  IF v_org_id IS NULL THEN RETURN; END IF;';
  c_antigo constant text :=
    E'  v_org_id := resolve_org_for_rpc(p_org_id);\n'
    || '  IF v_org_id IS NULL THEN RETURN; END IF;';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_uf_heatmap(uuid)'::regprocedure,
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF position(c_novo IN v_def) = 0 THEN
      RAISE NOTICE '% não tem a regra nova — nada a desfazer', v_sig;
      CONTINUE;
    END IF;
    EXECUTE replace(v_def, c_novo, c_antigo);
  END LOOP;
END
$volta$;

NOTIFY pgrst, 'reload schema';
