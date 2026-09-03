-- supabase/tests/lead_custom_fields_org_em_uso_test.sql
--
-- Guarda de 20270910000000_campos_personalizados_seguem_a_org_em_uso.sql.
--
-- Prova duas coisas que a versão anterior das policies errava:
--
--   (A) DEFINIÇÕES — `lead_custom_fields` resolvia o tenant com
--       `get_user_organization_id()`, a PRIMEIRA org do usuário por data de
--       vínculo. Quem pertence a duas orgs recebia as definições da errada, e a
--       tela — que filtra pela org selecionada — ficava vazia. Medido em prod
--       na Sampaio e Moraes (2026-09-02).
--
--   (B) RESPOSTAS — `lead_custom_field_values` tinha uma policy de SELECT mais
--       LARGA que a de `leads`: liberava as respostas de qualquer lead da org a
--       qualquer autenticado dela, inclusive numa org que restringe
--       visibilidade por vendedor. As respostas do formulário (faturamento,
--       volume, comprador) vazavam por chamada direta ao PostgREST.
--
-- Os dois cortes têm PLANTED FAILURE: o teste replanta a policy ANTIGA dentro
-- da transação e prova que ela falhava. Sem isso, um verde aqui poderia ser
-- verde à toa.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/lead_custom_fields_org_em_uso_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures
--
--   ORG_A  org antiga do multi-org (é a que `get_user_organization_id()` elege)
--   ORG_B  org NOVA do multi-org   (é a org em uso — a que a tela pede)
--   ORG_C  org que RESTRINGE visibilidade (leads.view_* = false)
--
--   U_MULTI  membro de A (vínculo mais velho) e de B
--   U_SOLO   membro só de C, sem responsabilidade sobre o lead de lá
--   U_DONO   membro de C, é o SDR do lead de lá (existe só para o lead ter dono)
--   U_MASTER master, sem vínculo em team_members
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('9a9a0910-aaaa-0000-0000-000000000910', 'Org A (multi, antiga)', 'org-a-0910-lcf', 'America/Sao_Paulo'),
  ('9a9a0910-bbbb-0000-0000-000000000910', 'Org B (multi, em uso)', 'org-b-0910-lcf', 'America/Sao_Paulo'),
  ('9a9a0910-cccc-0000-0000-000000000910', 'Org C (restrita)',      'org-c-0910-lcf', 'America/Sao_Paulo')
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
  ('9a9a0910-0001-0000-0000-000000000910'::uuid, 'multi-0910@test.local'),
  ('9a9a0910-0002-0000-0000-000000000910'::uuid, 'solo-0910@test.local'),
  ('9a9a0910-0003-0000-0000-000000000910'::uuid, 'dono-0910@test.local'),
  ('9a9a0910-0004-0000-0000-000000000910'::uuid, 'master-0910@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- O vínculo com a ORG_A nasce ANTES do da ORG_B: é isso que faz
-- `get_user_organization_id()` (ORDER BY created_at LIMIT 1) eleger a ORG_A.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active, created_at)
VALUES
  ('9a9a0910-1111-0000-0000-000000000910', '9a9a0910-aaaa-0000-0000-000000000910',
   '9a9a0910-0001-0000-0000-000000000910', 'Multi na A', 'member', true, now() - interval '30 days'),
  ('9a9a0910-2222-0000-0000-000000000910', '9a9a0910-bbbb-0000-0000-000000000910',
   '9a9a0910-0001-0000-0000-000000000910', 'Multi na B', 'member', true, now()),
  ('9a9a0910-3333-0000-0000-000000000910', '9a9a0910-cccc-0000-0000-000000000910',
   '9a9a0910-0002-0000-0000-000000000910', 'Solo na C', 'member', true, now()),
  ('9a9a0910-4444-0000-0000-000000000910', '9a9a0910-cccc-0000-0000-000000000910',
   '9a9a0910-0003-0000-0000-000000000910', 'Dono na C', 'member', true, now())
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('9a9a0910-0004-0000-0000-000000000910', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

-- O catálogo é pré-condição de `has_feature_permission`: sem a linha, a função
-- devolve false por NOT FOUND e o teste mediria outra coisa.
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value)
VALUES ('leads.view_all', 'Leads', 'Ver todos os leads', 'fixture', false, true)
ON CONFLICT (key) DO UPDATE SET default_value = true, is_admin_only = false;

-- ORG_C restringe de verdade: as TRÊS chaves em false (desligar só view_all não
-- restringe nada — ver PR #1662).
INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled)
SELECT '9a9a0910-cccc-0000-0000-000000000910', k, false
FROM unnest(ARRAY['leads.view_all','leads.view_unassigned','leads.view_subordinates']) AS k
ON CONFLICT DO NOTHING;

INSERT INTO public.lead_custom_fields (id, organization_id, field_name, field_type)
VALUES
  ('9a9a0910-fa00-0000-0000-000000000910', '9a9a0910-aaaa-0000-0000-000000000910', 'Campo da A', 'text'),
  ('9a9a0910-fb00-0000-0000-000000000910', '9a9a0910-bbbb-0000-0000-000000000910', 'Campo da B', 'text'),
  ('9a9a0910-fc00-0000-0000-000000000910', '9a9a0910-cccc-0000-0000-000000000910', 'Campo da C', 'text')
ON CONFLICT (id) DO NOTHING;

-- Lead da ORG_B sem dono; lead da ORG_C COM dono (o U_DONO), que é o que tira o
-- U_SOLO de todos os caminhos de `can_see_lead_by_permissions`.
INSERT INTO public.leads (id, organization_id, name, sdr_id)
VALUES
  ('9a9a0910-1ead-0000-0000-00000000000b', '9a9a0910-bbbb-0000-0000-000000000910', 'Lead da B', NULL),
  ('9a9a0910-1ead-0000-0000-00000000000c', '9a9a0910-cccc-0000-0000-000000000910', 'Lead da C',
   '9a9a0910-4444-0000-0000-000000000910')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_custom_field_values (id, lead_id, field_id, value)
VALUES
  ('9a9a0910-0a1e-0000-0000-00000000000b', '9a9a0910-1ead-0000-0000-00000000000b',
   '9a9a0910-fb00-0000-0000-000000000910', 'resposta da B'),
  ('9a9a0910-0a1e-0000-0000-00000000000c', '9a9a0910-1ead-0000-0000-00000000000c',
   '9a9a0910-fc00-0000-0000-000000000910', 'resposta da C')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) Estrutura — a policy passou a falar de org PLURAL
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_custom_fields'
      AND policyname = 'lead_custom_fields_select_organization'
      AND qual LIKE '%get_my_organization_ids%'),
  1,
  '(a) SELECT de lead_custom_fields resolve org por get_my_organization_ids()');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_custom_fields'
      AND qual LIKE '%get_user_organization_id%'),
  0,
  '(a) nenhuma policy de lead_custom_fields usa mais a org singular');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_custom_field_values'
      AND policyname = 'lead_custom_field_values_select_organization'),
  0,
  '(a) a policy larga de respostas por org não existe mais');

-- ---------------------------------------------------------------------------
-- (b) A ARMADILHA existe — sanidade da fixture
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"9a9a0910-0001-0000-0000-000000000910","role":"authenticated"}', true);

SELECT is(
  public.get_user_organization_id(),
  '9a9a0910-aaaa-0000-0000-000000000910'::uuid,
  '(b) get_user_organization_id() elege a org ANTIGA, não a org em uso');

-- ---------------------------------------------------------------------------
-- (c) DEFINIÇÕES — o multi-org vê as duas orgs dele, e só elas
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id = '9a9a0910-aaaa-0000-0000-000000000910'),
  1,
  '(c) multi-org vê o campo da org antiga');

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id = '9a9a0910-bbbb-0000-0000-000000000910'),
  1,
  '(c) multi-org vê o campo da ORG EM USO — o defeito da Sampaio e Moraes');

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id = '9a9a0910-cccc-0000-0000-000000000910'),
  0,
  '(c) multi-org NÃO vê campo de org alheia');

-- ---------------------------------------------------------------------------
-- (d) PLANTED FAILURE — replanta a policy antiga e prova que ela escondia
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
DROP POLICY lead_custom_fields_select_organization ON public.lead_custom_fields;
CREATE POLICY lead_custom_fields_select_organization
  ON public.lead_custom_fields FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_user_organization_id()));

SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id = '9a9a0910-bbbb-0000-0000-000000000910'),
  0,
  '(d) PLANTED: na policy ANTIGA o campo da org em uso desaparecia');

SET LOCAL role postgres;
DROP POLICY lead_custom_fields_select_organization ON public.lead_custom_fields;
CREATE POLICY lead_custom_fields_select_organization
  ON public.lead_custom_fields FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id = '9a9a0910-bbbb-0000-0000-000000000910'),
  1,
  '(d) restaurada a policy nova, o campo volta');

-- ---------------------------------------------------------------------------
-- (e) Membro de org única e master
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"9a9a0910-0002-0000-0000-000000000910","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id = '9a9a0910-cccc-0000-0000-000000000910'),
  1,
  '(e) membro de org única continua vendo os campos da org dele');

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE organization_id IN ('9a9a0910-aaaa-0000-0000-000000000910',
                              '9a9a0910-bbbb-0000-0000-000000000910')),
  0,
  '(e) membro de org única não vê campo das outras');

SELECT set_config('request.jwt.claims',
  '{"sub":"9a9a0910-0004-0000-0000-000000000910","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_fields
    WHERE id IN ('9a9a0910-fa00-0000-0000-000000000910',
                 '9a9a0910-fb00-0000-0000-000000000910',
                 '9a9a0910-fc00-0000-0000-000000000910')),
  3,
  '(e) master continua vendo cross-org pelas master_ghost_*');

-- ---------------------------------------------------------------------------
-- (f) RESPOSTAS — seguem exatamente quem enxerga o lead
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"9a9a0910-0001-0000-0000-000000000910","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_field_values
    WHERE lead_id = '9a9a0910-1ead-0000-0000-00000000000b'),
  1,
  '(f) multi-org lê a resposta do lead que ele enxerga (view_all default)');

SELECT set_config('request.jwt.claims',
  '{"sub":"9a9a0910-0002-0000-0000-000000000910","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_field_values
    WHERE lead_id = '9a9a0910-1ead-0000-0000-00000000000c'),
  0,
  '(f) em org restrita, quem não enxerga o lead não lê as respostas dele');

-- PLANTED FAILURE do vazamento: com a policy larga de volta, o mesmo usuário lê.
SET LOCAL role postgres;
CREATE POLICY lead_custom_field_values_select_organization
  ON public.lead_custom_field_values FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_custom_field_values.lead_id
      AND l.organization_id = (SELECT public.get_user_organization_id())));

SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_field_values
    WHERE lead_id = '9a9a0910-1ead-0000-0000-00000000000c'),
  1,
  '(f) PLANTED: a policy larga vazava a resposta para quem não vê o lead');

SET LOCAL role postgres;
DROP POLICY lead_custom_field_values_select_organization ON public.lead_custom_field_values;

SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.lead_custom_field_values
    WHERE lead_id = '9a9a0910-1ead-0000-0000-00000000000c'),
  0,
  '(f) removida a policy larga, o vazamento fecha de novo');

SELECT * FROM finish();
ROLLBACK;
