-- ANTES — ensaio da RPC set_org_settings contra PRODUÇÃO.
-- Nunca rodar sozinho: o .sh monta este + a migration + o `-depois`, que aborta.

BEGIN;

CREATE TEMP TABLE _os(chave text PRIMARY KEY, valor text) ON COMMIT DROP;

DO $$
DECLARE v_org uuid; v_admin uuid; v_membro uuid; v_outra uuid; v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='set_org_settings') THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: set_org_settings já existe. O ensaio mediria o que já estava lá.';
  END IF;

  -- Confirma o defeito que a migration ataca: organizations sem policy de UPDATE
  -- para não-master. Se alguém já tiver criado uma, o mundo mudou e o ensaio
  -- precisa ser repensado antes de aplicar.
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid='public.organizations'::regclass AND polcmd IN ('w','*')
     AND polname NOT LIKE 'master%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: já existe policy de UPDATE não-master em organizations (%). Remeça o diagnóstico.', v_n;
  END IF;

  -- Org com admin ativo E membro comum ativo, para testar os dois lados.
  SELECT o.id INTO v_org FROM public.organizations o
   WHERE EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id=o.id
                   AND m.role='admin' AND m.user_id IS NOT NULL AND m.is_active)
     AND EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id=o.id
                   AND m.role='member' AND m.user_id IS NOT NULL AND m.is_active)
     AND EXISTS (SELECT 1 FROM public.pipelines p WHERE p.organization_id=o.id AND p.is_active)
   LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: nenhuma org com admin E membro ativos e funil. Sem os dois lados o ensaio não separa quem pode de quem não pode.';
  END IF;

  SELECT m.user_id INTO v_admin  FROM public.team_members m
   WHERE m.organization_id=v_org AND m.role='admin'  AND m.user_id IS NOT NULL AND m.is_active LIMIT 1;
  SELECT m.user_id INTO v_membro FROM public.team_members m
   WHERE m.organization_id=v_org AND m.role='member' AND m.user_id IS NOT NULL AND m.is_active
     AND NOT EXISTS (SELECT 1 FROM public.master_users mu WHERE mu.user_id=m.user_id AND mu.is_active)
   LIMIT 1;
  IF v_membro IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: membro comum da org é master — não serve como controle de negação.';
  END IF;

  -- Funil de OUTRA org, para o teste de cross-tenant.
  SELECT p.id INTO v_outra FROM public.pipelines p
   WHERE p.organization_id <> v_org AND p.is_active LIMIT 1;

  INSERT INTO _os VALUES ('org', v_org::text), ('admin', v_admin::text),
                         ('membro', v_membro::text), ('funil_de_outra_org', v_outra::text);
END $$;
