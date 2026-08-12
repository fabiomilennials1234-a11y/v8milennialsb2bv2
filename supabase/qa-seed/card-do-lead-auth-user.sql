-- ============================================================================
-- Usuário de auth para a visualização do Card do Lead numa BRANCH EFÊMERA.
-- Nunca em prod. Complementa `fatia2-branch-seed.sql`, que cria org, funil,
-- lead e negócios mas nenhum usuário — sem isto ninguém entra na branch.
--
-- Uso:  node scripts/seed-branch.mjs --db-url "<url da branch>" \
--                                    --file supabase/qa-seed/card-do-lead-auth-user.sql
--
-- Espelha o que o GoTrue grava, porque a edge `create-org-user` é inalcançável
-- daqui. As colunas de token são '' e não NULL — o GoTrue lê string e quebra
-- com null. A identidade precisa de `provider_id` igual ao id do usuário, que é
-- o que o login por e-mail usa para casar.
--
-- As asserções levantam exceção. Rodar sem erro É o resultado.
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- ── O usuário ──────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  'aaaaaaaa-9999-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'card@preview.local',
  extensions.crypt('preview-card-2026', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Vendedor da Casa"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  'aaaaaaaa-9999-4000-8000-000000000001',
  'aaaaaaaa-9999-4000-8000-000000000001',
  '{"sub":"aaaaaaaa-9999-4000-8000-000000000001","email":"card@preview.local","email_verified":true}'::jsonb,
  'email', now(), now(), now()
)
on conflict do nothing;

-- ── Liga o usuário ao membro que o seed base já criou ──────────────────────
-- Sem o vínculo, `useOrganization` não resolve org nenhuma e o card nasce
-- desabilitado — o mesmo sintoma do gotcha `useAuth` sem organizationId.
update public.team_members
   set user_id = 'aaaaaaaa-9999-4000-8000-000000000001'
 where id = 'aaaaaaaa-1111-4000-8000-000000000001';

-- ── Enriquece o lead do seed para o card ter o que mostrar ─────────────────
-- O seed base cria só nome e telefone: o card renderia correto e vazio, o que
-- não deixa julgar o desenho. Estes valores são inventados, numa branch
-- descartável — nenhum dado de cliente entra aqui.
update public.leads
   set company     = 'Distética Comércio de Suplementos Ltda',
       email       = 'compras@distetica.com.br',
       uf          = 'SP',
       segment     = 'Suplementos',
       faturamento = 'R$ 500 mil – 1 mi',
       notes       = 'Compra em ciclo de 60 dias, sempre na primeira quinzena. '
                     'Prefere falar com a Luiza — já pediu para não receber disparo '
                     'automático. Trabalha com marca própria e pede amostra antes de '
                     'fechar linha nova. CNPJ ainda não confirmado no ERP.'
 where id = 'aaaaaaaa-3333-4000-8000-000000000001';

do $$
declare
  v_user int;
  v_ident int;
  v_membro int;
begin
  select count(*) into v_user from auth.users where id = 'aaaaaaaa-9999-4000-8000-000000000001';
  if v_user <> 1 then raise exception 'FALHA: usuário de auth não foi criado'; end if;

  select count(*) into v_ident from auth.identities
   where user_id = 'aaaaaaaa-9999-4000-8000-000000000001';
  if v_ident < 1 then raise exception 'FALHA: identidade de e-mail ausente — login por senha não casa'; end if;

  select count(*) into v_membro from public.team_members
   where id = 'aaaaaaaa-1111-4000-8000-000000000001'
     and user_id = 'aaaaaaaa-9999-4000-8000-000000000001';
  if v_membro <> 1 then raise exception 'FALHA: membro não ficou ligado ao usuário'; end if;

  raise notice '   OK(1): usuário card@preview.local criado e ligado ao membro da org de teste.';
end $$;
