-- mapa_uf_acesso_test.sql
--
-- Mapa de clientes: get_uf_heatmap e get_leads_by_uf com a regra de acesso da
-- plataforma (assert_org_access) — 20280111000500_mapa_uf_acesso_pela_regra_
-- da_plataforma.sql.
--
-- Antes: resolve_org_for_rpc (só team_members) → master e gestor recebiam 0
-- linhas em silêncio; membro desativado continuava lendo.
--
-- Fixtures — 2 orgs, 5 atores (mesmo padrão de assert_org_access_test.sql):
--   ATIVO     team_member ativo da org A
--   INATIVO   team_member DESATIVADO da org A (só isso)
--   MASTER    master_users ativo, sem team_members
--   GESTOR    gestor ativo com binding na org A, sem team_members
--   FORA      team_member ativo da org B
-- Leads na org A: SC, SC, SP e um sem UF. Na org B: um RJ.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(17);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('1f0d0001-aaaa-4000-8000-000000000a01', 'Org A (mapa)', 'org-a-mapa-uf', 'America/Sao_Paulo'),
  ('1f0d0001-bbbb-4000-8000-000000000b01', 'Org B (mapa)', 'org-b-mapa-uf', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
FROM (VALUES
  ('1f0d0002-0000-4000-8000-0000000000a1'::uuid, 'ativo-mapa@test.local'),
  ('1f0d0002-0000-4000-8000-0000000000a2'::uuid, 'inativo-mapa@test.local'),
  ('1f0d0002-0000-4000-8000-0000000000a3'::uuid, 'master-mapa@test.local'),
  ('1f0d0002-0000-4000-8000-0000000000a4'::uuid, 'gestor-mapa@test.local'),
  ('1f0d0002-0000-4000-8000-0000000000b1'::uuid, 'fora-mapa@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('1f0d0003-0000-4000-8000-0000000000a1', '1f0d0001-aaaa-4000-8000-000000000a01',
   '1f0d0002-0000-4000-8000-0000000000a1', 'Ativo', 'member', true),
  ('1f0d0003-0000-4000-8000-0000000000a2', '1f0d0001-aaaa-4000-8000-000000000a01',
   '1f0d0002-0000-4000-8000-0000000000a2', 'Inativo', 'member', false),
  ('1f0d0003-0000-4000-8000-0000000000b1', '1f0d0001-bbbb-4000-8000-000000000b01',
   '1f0d0002-0000-4000-8000-0000000000b1', 'Fora', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('1f0d0002-0000-4000-8000-0000000000a3', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestores (id, user_id, is_active)
VALUES ('1f0d0004-0000-4000-8000-0000000000a4', '1f0d0002-0000-4000-8000-0000000000a4', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestor_organizations (gestor_id, organization_id)
VALUES ('1f0d0004-0000-4000-8000-0000000000a4', '1f0d0001-aaaa-4000-8000-000000000a01')
ON CONFLICT (gestor_id, organization_id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, uf, uf_source)
VALUES
  ('1f0d0005-0000-4000-8000-000000000001', '1f0d0001-aaaa-4000-8000-000000000a01', 'Lead SC 1', 'SC', 'erp'),
  ('1f0d0005-0000-4000-8000-000000000002', '1f0d0001-aaaa-4000-8000-000000000a01', 'Lead SC 2', 'SC', 'ddd'),
  ('1f0d0005-0000-4000-8000-000000000003', '1f0d0001-aaaa-4000-8000-000000000a01', 'Lead SP', 'SP', 'ddd'),
  ('1f0d0005-0000-4000-8000-000000000004', '1f0d0001-aaaa-4000-8000-000000000a01', 'Lead sem UF', NULL, NULL),
  ('1f0d0005-0000-4000-8000-000000000005', '1f0d0001-bbbb-4000-8000-000000000b01', 'Lead RJ (B)', 'RJ', 'ddd')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- Resumo do mapa de uma org, como texto estável: "SC:2,SP:1|sem:1".
CREATE OR REPLACE FUNCTION pg_temp.resumo(p_org uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(trim(uf) || ':' || leads_count, ',' ORDER BY uf), '(vazio)')
         || '|sem:' || coalesce(max(unmapped_count)::text, '-')
  FROM public.get_uf_heatmap(p_org)
$$;

-- ── Contrato da função ────────────────────────────────────────────────────
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_uf_heatmap(uuid)'::regprocedure),
  'C1: get_uf_heatmap continua SECURITY DEFINER');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_leads_by_uf(character,integer,uuid)'::regprocedure),
  'C2: get_leads_by_uf continua SECURITY DEFINER');
SELECT ok(position('PERFORM public.assert_org_access(v_org_id);' IN pg_get_functiondef('public.get_uf_heatmap(uuid)'::regprocedure)) > 0
      AND position('PERFORM public.assert_org_access(v_org_id);' IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) > 0,
  'C3: as duas passam pela regra da plataforma (assert_org_access)');

SET LOCAL role authenticated;

-- ── Membro ATIVO ──────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0002-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT is(pg_temp.resumo('1f0d0001-aaaa-4000-8000-000000000a01'), 'SC:2,SP:1|sem:1',
  'M1: membro ativo vê o mapa da própria org (e quantos estão sem UF)');
SELECT is(pg_temp.resumo(NULL), 'SC:2,SP:1|sem:1',
  'M2: sem org explícita, a 1ª org de quem chama (como antes)');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0001-aaaa-4000-8000-000000000a01')), 2,
  'M3: membro ativo abre o relatório do estado');
SELECT throws_ok($$ SELECT * FROM public.get_uf_heatmap('1f0d0001-bbbb-4000-8000-000000000b01') $$,
  'P0001', 'access_denied', 'M4: membro ativo é barrado no mapa de outra org (antes: vazio em silêncio)');

-- ── Master ────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0002-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
SELECT is(pg_temp.resumo('1f0d0001-aaaa-4000-8000-000000000a01'), 'SC:2,SP:1|sem:1',
  'MA1: master vê o mapa da org que abriu (o defeito: recebia 0 linhas)');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0001-aaaa-4000-8000-000000000a01')), 2,
  'MA2: master abre o relatório do estado');
SELECT is((SELECT count(*)::int FROM public.get_uf_heatmap(NULL)), 0,
  'MA3: master sem org explícita não recebe nada (nem erro): não há org a resolver');

-- ── Gestor de portfólio ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0002-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
SELECT is(pg_temp.resumo('1f0d0001-aaaa-4000-8000-000000000a01'), 'SC:2,SP:1|sem:1',
  'G1: gestor vê o mapa da org que gerencia');
SELECT throws_ok($$ SELECT * FROM public.get_uf_heatmap('1f0d0001-bbbb-4000-8000-000000000b01') $$,
  'P0001', 'access_denied', 'G2: gestor é barrado na org que não gerencia');

-- ── Membro DESATIVADO ─────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0002-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok($$ SELECT * FROM public.get_uf_heatmap('1f0d0001-aaaa-4000-8000-000000000a01') $$,
  'P0001', 'access_denied', 'I1: membro desativado não lê mais o mapa (antes lia)');
SELECT throws_ok($$ SELECT * FROM public.get_leads_by_uf('SC', 60, '1f0d0001-aaaa-4000-8000-000000000a01') $$,
  'P0001', 'access_denied', 'I2: nem o relatório do estado');
SELECT throws_ok($$ SELECT * FROM public.get_uf_heatmap(NULL) $$,
  'P0001', 'access_denied', 'I3: sem org explícita, a org dele passa pela mesma regra');

-- ── Membro de OUTRA org ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0002-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok($$ SELECT * FROM public.get_leads_by_uf('SC', 60, '1f0d0001-aaaa-4000-8000-000000000a01') $$,
  'P0001', 'access_denied', 'F1: membro de outra org é barrado no relatório');
SELECT is(pg_temp.resumo('1f0d0001-bbbb-4000-8000-000000000b01'), 'RJ:1|sem:0',
  'F2: e vê o mapa da própria org, só com os leads dela');

SELECT * FROM finish();
ROLLBACK;
