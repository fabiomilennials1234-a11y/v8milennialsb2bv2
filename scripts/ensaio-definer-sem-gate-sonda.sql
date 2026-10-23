-- Sonda do ensaio/apply de 20271215000000_definer_sem_gate_fecha_execucao.sql.
-- Roda DEPOIS da migration, na MESMA transação. Não escreve nada que fique:
-- só leituras e chamadas que levantam antes de escrever.
--
-- Impersona um usuário REAL (team_member ativo de org não bloqueada) com
-- claims de JWT — SET ROLE sem claims não exercita gate nenhum.
-- Qualquer divergência levanta P0001 e aborta a transação inteira.
DO $sonda$
DECLARE
  v_user uuid;
  v_org uuid;
  v_lead_proprio uuid;
  v_lead_alheio uuid;
  v_org_alheia uuid;
  v_ok boolean;
BEGIN
  SELECT tm.user_id, tm.organization_id INTO v_user, v_org
    FROM public.team_members tm
    JOIN public.organizations o ON o.id = tm.organization_id
   WHERE tm.is_active AND tm.user_id IS NOT NULL
     AND NOT public.org_access_blocked(o.id)
     AND NOT public.is_master_user(tm.user_id)
     AND (SELECT count(DISTINCT t2.organization_id) FROM public.team_members t2
           WHERE t2.user_id = tm.user_id AND t2.is_active) = 1
     AND EXISTS (SELECT 1 FROM private.leads l WHERE l.organization_id = o.id)
   ORDER BY tm.organization_id
   LIMIT 1;
  SELECT l.id INTO v_lead_proprio FROM private.leads l WHERE l.organization_id = v_org LIMIT 1;
  SELECT l.id, l.organization_id INTO v_lead_alheio, v_org_alheia
    FROM private.leads l WHERE l.organization_id <> v_org LIMIT 1;

  IF v_user IS NULL OR v_lead_proprio IS NULL OR v_lead_alheio IS NULL THEN
    RAISE EXCEPTION 'sonda: sem usuário/lead para impersonar' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. controle positivo: o caminho legítimo do front segue funcionando
  PERFORM * FROM public.get_lead_write_instance(v_lead_proprio);

  -- 2. lead de outra org → 42501
  v_ok := false;
  BEGIN
    PERFORM * FROM public.get_lead_write_instance(v_lead_alheio);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'sonda: get_lead_write_instance aceitou lead de outra org' USING ERRCODE = 'P0001';
  END IF;

  -- 3. funil em outra org → 42501 (levanta antes do INSERT)
  v_ok := false;
  BEGIN
    PERFORM public.create_default_pipelines(v_org_alheia);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'sonda: create_default_pipelines aceitou org alheia' USING ERRCODE = 'P0001';
  END IF;

  -- 4. revogada → 42501 por falta de EXECUTE (não chega a ler nada)
  v_ok := false;
  BEGIN
    PERFORM public.api_list_team_members(v_org_alheia);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'sonda: api_list_team_members ainda executável por authenticated' USING ERRCODE = 'P0001';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'sonda ok: user % org %', v_user, v_org;
END
$sonda$;

SELECT 'sonda ok' AS resultado;
