-- supabase/tests/org_plural_em_todas_as_policies_test.sql
--
-- Guarda de 20270917000000_org_plural_nas_39_tabelas_restantes.sql.
--
-- (a) INVARIANTE DE SCHEMA — nenhuma policy do schema `public` pode resolver o
--     tenant por `get_user_organization_id()`, que devolve a org mais ANTIGA do
--     usuário (`ORDER BY created_at LIMIT 1`) e não a que ele está usando. Esta
--     asserção é o que impede a regressão voltar por uma policy nova amanhã: o
--     defeito não tem sintoma no ambiente de quem tem uma org só, e passa pelo
--     review exatamente por isso.
--
-- (b) FUNCIONAL, em `tags` — a etiqueta que o card do funil desenha, uma das 39.
--     Com PLANTED FAILURE: replanta a policy antiga dentro da transação e prova
--     que a tag da org em uso sumia.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/org_plural_em_todas_as_policies_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- ---------------------------------------------------------------------------
-- (a) O invariante
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%get_user_organization_id%'
           OR with_check LIKE '%get_user_organization_id%')),
  0,
  '(a) nenhuma policy resolve o tenant pela org SINGULAR');

-- Sanidade: a função continua existindo (outros chamadores dependem dela — ver
-- `has_feature_permission(text)`), então o invariante acima mede ausência de
-- USO em policy, não ausência da função.
SELECT has_function(
  'public', 'get_user_organization_id', ARRAY[]::text[],
  '(a) a função segue existindo — o invariante é sobre policy, não sobre ela');

-- ---------------------------------------------------------------------------
-- Fixtures — multi-org: ORG_A é o vínculo mais VELHO, ORG_B é a org em uso.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('9091709a-aaaa-0000-0000-000000917000', 'Org A (velha)', 'org-a-0917-tag', 'America/Sao_Paulo'),
  ('9091709a-bbbb-0000-0000-000000917000', 'Org B (em uso)', 'org-b-0917-tag', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
VALUES (
  '9091709a-0001-0000-0000-000000917000', 'multi-0917@test.local', '', now(), '{}'::jsonb,
  now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active, created_at)
VALUES
  ('9091709a-1111-0000-0000-000000917000', '9091709a-aaaa-0000-0000-000000917000',
   '9091709a-0001-0000-0000-000000917000', 'Multi na A', 'member', true, now() - interval '30 days'),
  ('9091709a-2222-0000-0000-000000917000', '9091709a-bbbb-0000-0000-000000917000',
   '9091709a-0001-0000-0000-000000917000', 'Multi na B', 'member', true, now())
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO public.tags (id, organization_id, name)
VALUES
  ('9091709a-7a61-0000-0000-00000091700a', '9091709a-aaaa-0000-0000-000000917000', 'Tag da A'),
  ('9091709a-7a61-0000-0000-00000091700b', '9091709a-bbbb-0000-0000-000000917000', 'Tag da B')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (b) Funcional em `tags`
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"9091709a-0001-0000-0000-000000917000","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.tags
    WHERE id IN ('9091709a-7a61-0000-0000-00000091700a',
                 '9091709a-7a61-0000-0000-00000091700b')),
  2,
  '(b) multi-org enxerga a tag das DUAS orgs dele');

-- PLANTED FAILURE — a policy antiga, singular.
SET LOCAL role postgres;
DROP POLICY IF EXISTS tags_select_organization ON public.tags;
CREATE POLICY tags_select_organization ON public.tags
  FOR SELECT TO public
  USING (organization_id = (SELECT public.get_user_organization_id()));

SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.tags
    WHERE id = '9091709a-7a61-0000-0000-00000091700b'),
  0,
  '(b) PLANTED: na policy ANTIGA a tag da org EM USO desaparecia');

SELECT is(
  (SELECT count(*)::int FROM public.tags
    WHERE id = '9091709a-7a61-0000-0000-00000091700a'),
  1,
  '(b) PLANTED: e só a da org velha sobrava — o sintoma exato do bug');

SET LOCAL role postgres;
DROP POLICY IF EXISTS tags_select_organization ON public.tags;
CREATE POLICY tags_select_organization ON public.tags
  FOR SELECT TO public
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.tags
    WHERE id IN ('9091709a-7a61-0000-0000-00000091700a',
                 '9091709a-7a61-0000-0000-00000091700b')),
  2,
  '(b) restaurada a policy nova, as duas voltam');

SELECT * FROM finish();
ROLLBACK;
