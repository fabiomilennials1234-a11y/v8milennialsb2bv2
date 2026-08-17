-- =====================================================================
-- Rafthel — criar org + 3 usuários no PROD (jsjsmuncfkbsbzqzqhfq)
-- Receita: memory/criar-usuario-org-via-sql.md + seed-funil-rpc-defasada.md
-- Rodar: node scripts/prod-sql-win.mjs --file scripts/rafthel-criar-org.sql
--
-- ⚠️ SENHAS REDIGIDAS (<SENHA_*>) — este script JÁ RODOU no PROD em 14/08/2026.
-- Ele é preservado como RECEITA reutilizável, não para reexecução: o guard de
-- duplicata nas linhas ~21-27 aborta se a org/e-mails já existirem.
-- As senhas reais da Rafthel ficam fora do repo (entregues ao cliente).
-- Para uma org nova: trocar nome/slug/e-mails e preencher <SENHA_*>.
-- =====================================================================

-- 1) Bypass service_role na conexão (trg_enforce_seat_limit -> assert_org_access)
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- 2) Bloco único = 1 transação: se qualquer passo falhar, NADA é gravado
DO $$
DECLARE
  v_org       uuid;
  v_user      uuid;
  v_ref_org   uuid := '70b8775e-7cbc-4b6f-90ba-2011002e57f7';  -- Loofting (33 etapas canônicas)
  r           record;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- guarda: não criar duplicata
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'rafthel' OR name ILIKE 'rafthel') THEN
    RAISE EXCEPTION 'Org Rafthel já existe — abortado';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email IN
      ('rafthel@rafthel.com.br','vendas6@rafthel.com.br','vendas4@rafthel.com.br')) THEN
    RAISE EXCEPTION 'Algum e-mail já existe em auth.users — abortado';
  END IF;

  -- ---------------------------------------------------------------
  -- ORG (triggers cuidam de: org_quotas, loss_reasons, feature_flags,
  --      org_onboarding_progress)
  -- ---------------------------------------------------------------
  INSERT INTO public.organizations (name, slug, subscription_plan, subscription_status, subscription_expires_at)
  VALUES ('Rafthel', 'rafthel', 'torque-2.0', 'active', NULL)
  RETURNING id INTO v_org;

  -- 3 funis system + 4 linhas de display (RPCs idempotentes, NÃO são trigger)
  PERFORM public.create_default_pipelines(v_org);
  PERFORM public.ensure_pipeline_display_config(v_org);

  -- ETAPAS: cópia da org de referência (a RPC create_default_pipeline_stages
  -- está defasada: 32 etapas, sem 'proposta_enviada' e com rótulos sem acento).
  -- Todas as FKs org-específicas da referência são NULL — cópia é segura.
  INSERT INTO public.pipeline_stages (
    organization_id, pipeline_type, stage_key, name, color, position,
    is_active, is_final_positive, is_final_negative,
    auto_move_min_days, auto_move_max_days, target_pipe_type, target_stage_key,
    default_probability, sla_hours, sla_action, max_days_in_stage, stage_role
  )
  SELECT v_org, ps.pipeline_type, ps.stage_key, ps.name, ps.color, ps.position,
         ps.is_active, ps.is_final_positive, ps.is_final_negative,
         ps.auto_move_min_days, ps.auto_move_max_days, ps.target_pipe_type, ps.target_stage_key,
         ps.default_probability, ps.sla_hours, ps.sla_action, ps.max_days_in_stage, ps.stage_role
  FROM public.pipeline_stages ps
  WHERE ps.organization_id = v_ref_org
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- ---------------------------------------------------------------
  -- USUÁRIOS (profiles e user_roles vêm por trigger — NÃO inserir)
  -- ---------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('Rafael',  'rafthel@rafthel.com.br', '<SENHA_RAFAEL>',  'admin'::public.app_role),
      ('Tatiele', 'vendas6@rafthel.com.br', '<SENHA_TATIELE>', 'member'::public.app_role),
      ('Carina',  'vendas4@rafthel.com.br', '<SENHA_CARINA>',  'member'::public.app_role)
    ) AS t(nome, email, senha, papel)
  LOOP
    v_user := gen_random_uuid();

    -- confirmed_at é GENERATED ALWAYS — não listar.
    -- Tokens '' e NUNCA NULL (NULL mata o login depois no GoTrue).
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, reauthentication_token, phone_change, phone_change_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      r.email, extensions.crypt(r.senha, extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.nome, 'email_verified', true),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );

    -- auth.identities.email é GENERATED ALWAYS — não listar.
    -- Sem essa linha o usuário existe, tem senha e NÃO loga.
    INSERT INTO auth.identities (
      id, user_id, provider, provider_id, identity_data, created_at, updated_at, last_sign_in_at
    ) VALUES (
      gen_random_uuid(), v_user, 'email', v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', r.email,
                         'email_verified', false, 'phone_verified', false),
      now(), now(), NULL
    );

    INSERT INTO public.team_members (user_id, organization_id, name, email, role, is_active, metric_type)
    VALUES (v_user, v_org, r.nome, r.email, r.papel, true, 'meetings');
  END LOOP;

  RAISE NOTICE 'Rafthel criada: %', v_org;
END $$;

-- 3) GABARITO (único resultado devolvido pela Management API)
WITH org AS (SELECT * FROM public.organizations WHERE slug = 'rafthel'),
ref AS (SELECT * FROM public.pipeline_stages WHERE organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'),
nova AS (SELECT ps.* FROM public.pipeline_stages ps JOIN org ON org.id = ps.organization_id),
-- 'senha_confere' abaixo compara o hash bcrypt contra estas senhas; com os
-- placeholders ele devolve false. Preencher para reusar a verificação.
senhas(email, senha) AS (VALUES
  ('rafthel@rafthel.com.br','<SENHA_RAFAEL>'),
  ('vendas6@rafthel.com.br','<SENHA_TATIELE>'),
  ('vendas4@rafthel.com.br','<SENHA_CARINA>'))
SELECT jsonb_pretty(jsonb_build_object(
  'org', (SELECT jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'plano',o.subscription_plan,
                                    'status',o.subscription_status,'expira',o.subscription_expires_at) FROM org o),
  'funis',    (SELECT count(*) FROM public.pipelines p JOIN org ON org.id=p.organization_id),
  'etapas',   (SELECT count(*) FROM nova),
  'display',  (SELECT count(*) FROM public.pipeline_display_config d JOIN org ON org.id=d.organization_id),
  'motivos_perda', (SELECT count(*) FROM public.loss_reasons l JOIN org ON org.id=l.organization_id),
  'etapas_divergentes_vs_referencia', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('pt',coalesce(n.pipeline_type,f.pipeline_type),
                                                 'key',coalesce(n.stage_key,f.stage_key),
                                                 'nova',n.name,'ref',f.name)),'[]'::jsonb)
    FROM nova n FULL OUTER JOIN ref f
      ON f.pipeline_type=n.pipeline_type AND f.stage_key=n.stage_key
    WHERE n.id IS NULL OR f.id IS NULL
       OR n.name IS DISTINCT FROM f.name OR n.color IS DISTINCT FROM f.color
       OR n.position IS DISTINCT FROM f.position OR n.stage_role IS DISTINCT FROM f.stage_role
       OR n.is_final_positive IS DISTINCT FROM f.is_final_positive
       OR n.is_final_negative IS DISTINCT FROM f.is_final_negative
       OR n.target_pipe_type IS DISTINCT FROM f.target_pipe_type
       OR n.target_stage_key IS DISTINCT FROM f.target_stage_key
  ),
  'quotas', (SELECT coalesce(jsonb_agg(jsonb_build_object('k',q.resource_key,'base',q.plan_base,
                                                          'adj',q.admin_adjustment,'eff',q.effective_limit)),'[]'::jsonb)
             FROM public.org_quotas q JOIN org ON org.id=q.organization_id),
  'quota_users', (SELECT public.org_resolve_quota((SELECT id FROM org),'max_users')),
  'membros', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'nome', tm.name, 'email', tm.email, 'papel', tm.role, 'ativo', tm.is_active,
      'user_id', tm.user_id,
      'profile', (SELECT p.full_name FROM public.profiles p WHERE p.id = tm.user_id),
      'identities', (SELECT count(*) FROM auth.identities i WHERE i.user_id = tm.user_id),
      'user_roles', (SELECT coalesce(jsonb_agg(ur.role),'[]'::jsonb) FROM public.user_roles ur WHERE ur.user_id = tm.user_id),
      'senha_confere', (SELECT u.encrypted_password = extensions.crypt(s.senha, u.encrypted_password)
                        FROM auth.users u JOIN senhas s ON s.email = u.email WHERE u.id = tm.user_id),
      'tokens_nulos', (SELECT (u.confirmation_token IS NULL OR u.recovery_token IS NULL
                            OR u.email_change IS NULL OR u.email_change_token_new IS NULL
                            OR u.email_change_token_current IS NULL OR u.reauthentication_token IS NULL
                            OR u.phone_change IS NULL OR u.phone_change_token IS NULL)
                       FROM auth.users u WHERE u.id = tm.user_id),
      'email_confirmado', (SELECT u.email_confirmed_at IS NOT NULL FROM auth.users u WHERE u.id = tm.user_id)
    ) ORDER BY tm.role, tm.name), '[]'::jsonb)
    FROM public.team_members tm JOIN org ON org.id = tm.organization_id
  ),
  'assentos_duplicados', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',x.user_id,'n',x.n)),'[]'::jsonb)
    FROM (SELECT tm.user_id, count(*) n FROM public.team_members tm JOIN org ON org.id=tm.organization_id
          GROUP BY tm.user_id HAVING count(*) > 1) x
  ),
  'orfaos_auth_sem_membro', (
    SELECT coalesce(jsonb_agg(u.email),'[]'::jsonb) FROM auth.users u
    WHERE u.email LIKE '%@rafthel.com.br'
      AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = u.id)
  )
)) AS gabarito;
