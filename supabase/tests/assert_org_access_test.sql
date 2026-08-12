-- supabase/tests/assert_org_access_test.sql
--
-- ISSUE #1209 — gate de tenancy dos leitores SECURITY DEFINER.
--
-- Prova os 5 caminhos de decisão de public.assert_org_access(uuid) e da irmã
-- public.assert_org_member(uuid), corrigidas em
-- 20270726000000_assert_org_access_require_active_member.sql:
--
--   (b) membro ATIVO       → passa na própria org, é bloqueado em org alheia
--   (c) membro DESATIVADO  → BLOQUEADO (o furo: antes passava)
--   (d) master             → passa em qualquer org
--   (e) service_role       → passa (backend/cron)
--   (f) gestor de portfólio→ passa nas orgs que gerencia, bloqueado nas outras
--   (g) p_org_id NULL      → bloqueado
--   (h) assert_org_member  → mesmo veredito nos 5 caminhos
--   (i) PLANTED FAILURE    → replanta a definição ANTIGA (sem is_active) dentro
--                            da transação e prova que o membro desativado
--                            PASSAVA nela. Sem isto, (c) poderia estar passando
--                            à toa e o teste não seria load-bearing.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/assert_org_access_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(25);

-- ---------------------------------------------------------------------------
-- (a) Estrutura e grants
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'assert_org_access', ARRAY['uuid'],
  '(a) assert_org_access(uuid) existe');

SELECT has_function(
  'public', 'assert_org_member', ARRAY['uuid'],
  '(a) assert_org_member(uuid) existe');

SELECT ok(
  has_function_privilege('authenticated', 'public.assert_org_access(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.assert_org_access(uuid)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated + service_role');

SELECT ok(
  NOT has_function_privilege('anon', 'public.assert_org_access(uuid)', 'EXECUTE'),
  '(a) anon NÃO executa o gate');

-- ---------------------------------------------------------------------------
-- Fixtures — 2 orgs, 4 atores:
--   U_ACTIVE   team_member da org A, is_active = true
--   U_INACTIVE team_member da org A, is_active = false  (e SÓ isso)
--   U_MASTER   master_users ativo, sem vínculo em team_members
--   U_GESTOR   gestor ativo com binding pra org A, sem vínculo em team_members
--              (espelha o estado real de prod: o gestor vive FORA de
--               team_members — ver ADR-0021)
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('12091209-aaaa-0000-0000-000000001209', 'Org A (#1209)', 'org-a-1209-aoa', 'America/Sao_Paulo'),
  ('12091209-bbbb-0000-0000-000000001209', 'Org B (#1209)', 'org-b-1209-aoa', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT
  u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('12091209-0001-0000-0000-000000001209'::uuid, 'active-1209@test.local'),
  ('12091209-0002-0000-0000-000000001209'::uuid, 'inactive-1209@test.local'),
  ('12091209-0003-0000-0000-000000001209'::uuid, 'master-1209@test.local'),
  ('12091209-0004-0000-0000-000000001209'::uuid, 'gestor-1209@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('12091209-1111-0000-0000-000000001209', '12091209-aaaa-0000-0000-000000001209',
   '12091209-0001-0000-0000-000000001209', 'Membro Ativo', 'member', true),
  ('12091209-2222-0000-0000-000000001209', '12091209-aaaa-0000-0000-000000001209',
   '12091209-0002-0000-0000-000000001209', 'Membro Desativado', 'member', false)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('12091209-0003-0000-0000-000000001209', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestores (id, user_id, is_active)
VALUES ('12091209-3333-0000-0000-000000001209',
        '12091209-0004-0000-0000-000000001209', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestor_organizations (gestor_id, organization_id)
VALUES ('12091209-3333-0000-0000-000000001209',
        '12091209-aaaa-0000-0000-000000001209')
ON CONFLICT (gestor_id, organization_id) DO NOTHING;

-- Fixtures prontas: devolve o replication_role ao normal para que o restante da
-- suíte exercite triggers/FKs como em runtime real.
SET LOCAL session_replication_role = origin;

-- Sanidade da fixture: o desativado NÃO tem nenhum vínculo ativo na org A.
-- Se isto quebrar, (c) estaria testando outra coisa.
SELECT is(
  (SELECT count(*)::int FROM public.team_members
   WHERE user_id = '12091209-0002-0000-0000-000000001209'
     AND organization_id = '12091209-aaaa-0000-0000-000000001209'
     AND is_active = true),
  0,
  '(fixture) membro desativado não possui vínculo ativo na org A');

-- Sanidade da fixture: o gestor NÃO é team_member (espelha prod).
SELECT is(
  (SELECT count(*)::int FROM public.team_members
   WHERE user_id = '12091209-0004-0000-0000-000000001209'),
  0,
  '(fixture) gestor vive fora de team_members');

-- ---------------------------------------------------------------------------
-- (b) Membro ATIVO
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0001-0000-0000-000000001209","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  '(b) membro ATIVO passa na própria org');

SELECT throws_ok(
  $$ SELECT public.assert_org_access('12091209-bbbb-0000-0000-000000001209') $$,
  'P0001', 'access_denied',
  '(b) membro ATIVO é bloqueado em org alheia');

-- ---------------------------------------------------------------------------
-- (c) Membro DESATIVADO — o corte que esta migration existe pra provar
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0002-0000-0000-000000001209","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  'P0001', 'access_denied',
  '(c) membro DESATIVADO é BLOQUEADO na org que o desativou');

SELECT throws_ok(
  $$ SELECT public.assert_org_member('12091209-aaaa-0000-0000-000000001209') $$,
  'P0001', 'access_denied',
  '(c) membro DESATIVADO é BLOQUEADO também em assert_org_member');

-- ---------------------------------------------------------------------------
-- (d) Master
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0003-0000-0000-000000001209","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  '(d) master passa na org A');

SELECT lives_ok(
  $$ SELECT public.assert_org_access('12091209-bbbb-0000-0000-000000001209') $$,
  '(d) master passa na org B (cross-org)');

SELECT lives_ok(
  $$ SELECT public.assert_org_member('12091209-bbbb-0000-0000-000000001209') $$,
  '(d) master passa em assert_org_member cross-org');

-- ---------------------------------------------------------------------------
-- (e) service_role — backend e cron
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0002-0000-0000-000000001209","role":"service_role"}', true);

SELECT lives_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  '(e) service_role passa (mesmo com sub de usuário desativado)');

SELECT lives_ok(
  $$ SELECT public.assert_org_member('12091209-bbbb-0000-0000-000000001209') $$,
  '(e) service_role passa em assert_org_member');

-- ---------------------------------------------------------------------------
-- (f) Gestor de portfólio (ADR-0021)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0004-0000-0000-000000001209","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  '(f) gestor passa na org que gerencia');

SELECT throws_ok(
  $$ SELECT public.assert_org_access('12091209-bbbb-0000-0000-000000001209') $$,
  'P0001', 'access_denied',
  '(f) gestor é bloqueado em org que NÃO gerencia');

SELECT lives_ok(
  $$ SELECT public.assert_org_member('12091209-aaaa-0000-0000-000000001209') $$,
  '(f) gestor passa em assert_org_member na org que gerencia');

-- Gestor DESATIVADO também perde o acesso (get_my_gestor_organization_ids
-- filtra g.is_active).
SET LOCAL role postgres;
UPDATE public.gestores SET is_active = false
WHERE id = '12091209-3333-0000-0000-000000001209';
SET LOCAL role authenticated;

SELECT throws_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  'P0001', 'access_denied',
  '(f) gestor DESATIVADO perde o acesso');

SET LOCAL role postgres;
UPDATE public.gestores SET is_active = true
WHERE id = '12091209-3333-0000-0000-000000001209';
SET LOCAL role authenticated;

-- ---------------------------------------------------------------------------
-- (g) p_org_id NULL nunca concede
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0001-0000-0000-000000001209","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.assert_org_access(NULL::uuid) $$,
  'P0001', 'access_denied',
  '(g) p_org_id NULL é bloqueado mesmo pra membro ativo');

SELECT throws_ok(
  $$ SELECT public.assert_org_member(NULL::uuid) $$,
  'P0001', 'access_denied',
  '(g) p_org_id NULL é bloqueado em assert_org_member');

-- ---------------------------------------------------------------------------
-- (h) Regressão dos leitores canônicos: membro ATIVO segue lendo.
--     Guarda contra "apertei o gate e matei todo mundo".
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.get_sales_metrics('12091209-aaaa-0000-0000-000000001209','month','2027-07-15') $$,
  '(h) membro ATIVO continua lendo get_sales_metrics (sem regressão)');

SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0002-0000-0000-000000001209","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.get_sales_metrics('12091209-aaaa-0000-0000-000000001209','month','2027-07-15') $$,
  'P0001', 'access_denied',
  '(h) membro DESATIVADO NÃO lê mais get_sales_metrics — o furo do #1209');

-- ---------------------------------------------------------------------------
-- (i) PLANTED FAILURE — prova que o teste é load-bearing.
--
-- Replanta a definição ANTIGA (existência de vínculo, sem is_active, sem
-- gestor) e afirma que sob ELA o membro desativado PASSAVA. Se este bloco
-- falhasse, (c) estaria verde por acidente. Tudo dentro da transação revertida.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;

CREATE OR REPLACE FUNCTION public.assert_org_access(p_org_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $planted$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;
  IF public.is_master_user() THEN RETURN; END IF;
  IF p_org_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_members
    WHERE organization_id = p_org_id AND user_id = auth.uid()
  ) THEN RETURN; END IF;
  RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
END; $planted$;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0002-0000-0000-000000001209","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  '(i) PLANTED: definição ANTIGA deixava o membro DESATIVADO passar — (c) é load-bearing');

-- E provava também que o gestor estava quebrado na definição antiga.
SELECT set_config('request.jwt.claims',
  '{"sub":"12091209-0004-0000-0000-000000001209","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.assert_org_access('12091209-aaaa-0000-0000-000000001209') $$,
  'P0001', 'access_denied',
  '(i) PLANTED: definição ANTIGA bloqueava o gestor — (f) é load-bearing');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
