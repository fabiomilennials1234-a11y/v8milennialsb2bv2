-- supabase/tests/pipeline_view_all_test.sql
--
-- Visualização no Funil separada de Leads
-- (migration 20271218000000_pipeline_view_all.sql, ADR-0042).
--
--   (KY) a chave existe, default TRUE, não é admin-only.
--   (GR) GRANTs: helpers e lead_tem_card_no_funil só para authenticated.
--   (PO) as 3 policies são RESTRICTIVE; a permissive de org continua lá.
--   (EQ) EQUIVALÊNCIA: com a chave no default (true), cada persona vê EXATAMENTE
--        as linhas que via antes (org do usuário, ou tudo se master).
--   (MX) matriz persona × chave: admin, gestor, master, member sem/com chave,
--        co-dono, atribuído só pelo card, sem dono, admin de OUTRA org, outra
--        org, anon.
--   (AD) admin bypass é POR ORG: admin da B, restrito na A, só vê o dele na A.
--   (CT) contador por etapa == lista (mesma RLS).
--   (OD) default da org desligado + override do membro ligado.
--   (WR) UPDATE/DELETE de card invisível afetam 0 linhas.
--   (RP) lead_tem_card_no_funil: vê o que o caller não vê, sem vazar org.
--   (AB) abrir_negocio: recusa de domínio em vez de 23505 cego; admin adota.
--   (RT) Broadcast: quem tem o Funil restrito não entra no tópico da org.
--
-- Roda inteiro em transação revertida. NÃO foi executado no ambiente em que foi
-- escrito (sem psql/branch): rode com `supabase test db` num preview.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (sem triggers)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('b1d0a11a-0000-4000-8000-0000000000a0', 'Org PVA A', 'org-pva-a', 'America/Sao_Paulo'),
  ('b1d0a11a-0000-4000-8000-0000000000b0', 'Org PVA B', 'org-pva-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('b1d0a11a-0000-4000-8000-000000000001', 'pva-admin-a@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000002', 'pva-gestor@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000003', 'pva-master@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000004', 'pva-restrito@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000005', 'pva-aberto@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000006', 'pva-codono@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000007', 'pva-atribuido@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000008', 'pva-semdono@test.local'),
    ('b1d0a11a-0000-4000-8000-000000000009', 'pva-adminb-restritoa@test.local'),
    ('b1d0a11a-0000-4000-8000-00000000000a', 'pva-override-true@test.local'),
    ('b1d0a11a-0000-4000-8000-00000000000b', 'pva-membro-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- 01 admin A · 04 restrito (dono L1) · 05 sem override (dono L2) · 06 co-dono L2
-- 07 só atribuído pelo card E3 · 08 ninguém · 09a restrito na A (dono L5) e 09b
-- ADMIN na B · 0a override true · 0b membro da B
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('b1d0a11a-0000-4000-8000-000000000101', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000001', 'Admin A',    'admin',  true),
  ('b1d0a11a-0000-4000-8000-000000000104', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000004', 'Restrito A', 'member', true),
  ('b1d0a11a-0000-4000-8000-000000000105', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000005', 'Aberto A',   'member', true),
  ('b1d0a11a-0000-4000-8000-000000000106', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000006', 'Co-dono A',  'member', true),
  ('b1d0a11a-0000-4000-8000-000000000107', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000007', 'Atribuido A','member', true),
  ('b1d0a11a-0000-4000-8000-000000000108', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000008', 'Sem dono A', 'member', true),
  ('b1d0a11a-0000-4000-8000-00000000019a', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000009', 'Hibrido A',  'member', true),
  ('b1d0a11a-0000-4000-8000-00000000019b', 'b1d0a11a-0000-4000-8000-0000000000b0', 'b1d0a11a-0000-4000-8000-000000000009', 'Hibrido B',  'admin',  true),
  ('b1d0a11a-0000-4000-8000-00000000010a', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-00000000000a', 'Override A', 'member', true),
  ('b1d0a11a-0000-4000-8000-00000000010b', 'b1d0a11a-0000-4000-8000-0000000000b0', 'b1d0a11a-0000-4000-8000-00000000000b', 'Membro B',   'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('b1d0a11a-0000-4000-8000-000000000003', true);

-- Gestor de portfólio da org A: sem team_member, entra por gestores.
INSERT INTO public.gestores (id, user_id, is_active)
VALUES ('b1d0a11a-0000-4000-8000-0000000009e1', 'b1d0a11a-0000-4000-8000-000000000002', true);
INSERT INTO public.gestor_organizations (gestor_id, organization_id)
VALUES ('b1d0a11a-0000-4000-8000-0000000009e1', 'b1d0a11a-0000-4000-8000-0000000000a0');

-- Leads. L1 dono 04 · L2 dono 05 + co-dono 06 · L3 sem dono (card atribuído ao
-- 07) · L4 sem dono nenhum · L5 dono 09a · LB org B.
INSERT INTO public.leads (id, organization_id, name, sale_responsible_id, closer_id) VALUES
  ('b1d0a11a-0000-4000-8000-000000000201', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L1', 'b1d0a11a-0000-4000-8000-000000000104', 'b1d0a11a-0000-4000-8000-000000000104'),
  ('b1d0a11a-0000-4000-8000-000000000202', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L2', 'b1d0a11a-0000-4000-8000-000000000105', 'b1d0a11a-0000-4000-8000-000000000105'),
  ('b1d0a11a-0000-4000-8000-000000000203', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L3', NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000204', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L4', NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000205', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L5', 'b1d0a11a-0000-4000-8000-00000000019a', 'b1d0a11a-0000-4000-8000-00000000019a'),
  ('b1d0a11a-0000-4000-8000-000000000206', 'b1d0a11a-0000-4000-8000-0000000000b0', 'LB', NULL, NULL),
  -- L7 sem dono, mas o METADATA do card aponta para o 04 · L8 de OUTRA pessoa (05)
  -- com card de outra pessoa · L10 sem dono, dois cards: um meu (04), um do 05.
  ('b1d0a11a-0000-4000-8000-000000000207', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L7',  NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000208', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L8',  'b1d0a11a-0000-4000-8000-000000000105', 'b1d0a11a-0000-4000-8000-000000000105'),
  ('b1d0a11a-0000-4000-8000-000000000210', 'b1d0a11a-0000-4000-8000-0000000000a0', 'L10', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source) VALUES
  ('b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-000000000202', 'b1d0a11a-0000-4000-8000-000000000106', 'co', false, 'manual');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-0000000000a0', 'Oportunidades A', 'whatsapp', 'system'),
  ('b1d0a11a-0000-4000-8000-0000000003b1', 'b1d0a11a-0000-4000-8000-0000000000b0', 'Oportunidades B', 'whatsapp', 'system'),
  ('b1d0a11a-0000-4000-8000-0000000003a2', 'b1d0a11a-0000-4000-8000-0000000000a0', 'Propostas A', 'propostas', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active) VALUES
  ('b1d0a11a-0000-4000-8000-0000000004a1', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'whatsapp', 'novo_lead', 'Novo Lead', 0, true),
  ('b1d0a11a-0000-4000-8000-0000000004b1', 'b1d0a11a-0000-4000-8000-0000000000b0', 'b1d0a11a-0000-4000-8000-0000000003b1', 'whatsapp', 'novo_lead', 'Novo Lead', 0, true),
  ('b1d0a11a-0000-4000-8000-0000000004a2', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a2', 'propostas', 'enviada', 'Enviada', 0, true)
ON CONFLICT (id) DO NOTHING;

-- E1..E5 na A (L1..L5) · E6 na B · E7 na A SEM lead. E3 atribuído ao 07.
-- E5 está FECHADO (para o espelho do índice parcial em lead_tem_card_no_funil).
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, assigned_to, closed_at)
VALUES
  ('b1d0a11a-0000-4000-8000-000000000501', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000201', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000502', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000202', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000503', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000203', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', 'b1d0a11a-0000-4000-8000-000000000107', NULL),
  ('b1d0a11a-0000-4000-8000-000000000504', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000204', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000505', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000205', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', NULL, now()),
  ('b1d0a11a-0000-4000-8000-000000000506', 'b1d0a11a-0000-4000-8000-0000000000b0', 'b1d0a11a-0000-4000-8000-0000000003b1', 'b1d0a11a-0000-4000-8000-000000000206', 'b1d0a11a-0000-4000-8000-0000000004b1', 'novo_lead', NULL, NULL),
  ('b1d0a11a-0000-4000-8000-000000000507', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', NULL,                                   'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', NULL, NULL);

-- E8: lead sem dono; só o METADATA do card aponta para o 04 (caixa alta de propósito).
-- E9: lead da 05, card da 05. E10/E11: mesmo lead (L10) em dois funis — E10 é
-- do 04, E11 é da 05: o 04 só aparece em OUTRO card.
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, assigned_to, metadata)
VALUES
  ('b1d0a11a-0000-4000-8000-000000000508', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000207', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', NULL, '{"sdr_id": "B1D0A11A-0000-4000-8000-000000000104"}'::jsonb),
  ('b1d0a11a-0000-4000-8000-000000000509', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000208', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', 'b1d0a11a-0000-4000-8000-000000000105', '{}'::jsonb),
  ('b1d0a11a-0000-4000-8000-000000000510', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-000000000210', 'b1d0a11a-0000-4000-8000-0000000004a1', 'novo_lead', 'b1d0a11a-0000-4000-8000-000000000104', '{}'::jsonb),
  ('b1d0a11a-0000-4000-8000-000000000511', 'b1d0a11a-0000-4000-8000-0000000000a0', 'b1d0a11a-0000-4000-8000-0000000003a2', 'b1d0a11a-0000-4000-8000-000000000210', 'b1d0a11a-0000-4000-8000-0000000004a2', 'enviada',   'b1d0a11a-0000-4000-8000-000000000105', '{}'::jsonb);

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- Linhas afetadas por um DML, contadas FORA de subconsulta: `WITH x AS (UPDATE …)`
-- só é válido no nível de topo. SECURITY INVOKER (padrão): a RLS do papel
-- corrente vale, exatamente como num UPDATE comum.
CREATE FUNCTION pg_temp.afetadas(p_sql text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Ids (2 últimos dígitos) dos cards que a persona VÊ, sob RLS de authenticated.
CREATE FUNCTION pg_temp.vistos(p_user uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COALESCE(string_agg(right(pe.id::text, 2), ',' ORDER BY pe.id), '')
    INTO r FROM public.pipeline_entries pe;
  RESET ROLE;
  RETURN r;
END $$;

-- O que a persona via ANTES: org do usuário (pipeline_entries_select) ou tudo,
-- se master (master_select_all_pipeline_entries). Lido como dono do banco.
CREATE FUNCTION pg_temp.antigo(p_user uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SELECT COALESCE(string_agg(right(pe.id::text, 2), ',' ORDER BY pe.id), '')
    INTO r
    FROM public.pipeline_entries pe
   WHERE pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR public.is_master_user();
  RETURN r;
END $$;

CREATE FUNCTION pg_temp.vistos_anon() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  BEGIN
    -- anon de verdade não tem `sub`: sem isto herdaria os claims da persona anterior.
    PERFORM set_config('request.jwt.claims', '{}', true);
    SET LOCAL ROLE anon;
    SELECT COALESCE(string_agg(right(pe.id::text, 2), ',' ORDER BY pe.id), '')
      INTO r FROM public.pipeline_entries pe;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    r := 'ERR:' || SQLSTATE;
  END;
  RETURN r;
END $$;

-- ===========================================================================
-- (KY) a chave
-- ===========================================================================
SELECT ok(EXISTS (SELECT 1 FROM public.feature_permissions
                   WHERE key = 'pipeline.view_all' AND default_value AND NOT is_admin_only
                     AND module = 'Pipeline'),
  'KY1: pipeline.view_all existe, módulo Pipeline, default TRUE, não admin-only');

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(NOT has_function_privilege('anon', 'public.lead_tem_card_no_funil(uuid, uuid, boolean)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.rls_my_orgs_pipeline_view_all()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.rls_my_pipeline_lead_ids()', 'EXECUTE'),
  'GR1: anon não executa nenhum helper novo');
SELECT ok(has_function_privilege('authenticated', 'public.lead_tem_card_no_funil(uuid, uuid, boolean)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.rls_my_orgs_pipeline_view_all()', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.rls_my_pipeline_lead_ids()', 'EXECUTE'),
  'GR2: authenticated executa os helpers (a policy roda como ele)');
SELECT ok(has_function_privilege('service_role', 'public.lead_tem_card_no_funil(uuid, uuid, boolean)', 'EXECUTE'),
  'GR2b: service_role executa lead_tem_card_no_funil — abrir_negocio (invoker) a chama em todo caminho sem card visível; sem EXECUTE, todo POST /deals e workflow quebrariam');
SELECT ok((SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
             FROM pg_proc p
            WHERE p.oid IN ('public.lead_tem_card_no_funil(uuid, uuid, boolean)'::regprocedure,
                            'public.rls_my_orgs_pipeline_view_all()'::regprocedure,
                            'public.rls_my_pipeline_lead_ids()'::regprocedure)),
  'GR3: os 3 helpers são SECURITY DEFINER com search_path fixo');

-- ===========================================================================
-- (PO) policies
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_policy
    WHERE polrelid = 'public.pipeline_entries'::regclass
      AND polname IN ('pipeline_view_all_select', 'pipeline_view_all_update', 'pipeline_view_all_delete')
      AND NOT polpermissive),
  3, 'PO1: as 3 policies de pipeline_view_all são RESTRICTIVE');
SELECT ok(EXISTS (SELECT 1 FROM pg_policy
                   WHERE polrelid = 'public.pipeline_entries'::regclass
                     AND polname = 'pipeline_entries_select' AND polpermissive),
  'PO2: a permissive de org (pipeline_entries_select) continua; a nova só restringe');

-- ===========================================================================
-- (EQ) equivalência com a chave no DEFAULT (ninguém tem override ainda)
-- ===========================================================================
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000001'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000001'), 'EQ1: admin A == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000002'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000002'), 'EQ2: gestor == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000003'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000003'), 'EQ3: master == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000004'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000004'), 'EQ4: membro restrito-a-ser == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000005'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000005'), 'EQ5: membro == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000006'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000006'), 'EQ6: co-dono == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000007'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000007'), 'EQ7: atribuído == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000008'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000008'), 'EQ8: sem dono == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000009'), pg_temp.antigo('b1d0a11a-0000-4000-8000-000000000009'), 'EQ9: híbrido A/B == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-00000000000b'), pg_temp.antigo('b1d0a11a-0000-4000-8000-00000000000b'), 'EQ10: membro da B == antes');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000005'), '01,02,03,04,05,07,08,09,10,11',
  'EQ11: sanidade — membro com a chave no default vê os 10 cards da org A e nenhum da B');

-- ===========================================================================
-- Agora a chave é desligada para os "restritos" (override do membro)
-- ===========================================================================
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('b1d0a11a-0000-4000-8000-000000000101', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false), -- ADMIN também: o bypass é do papel
  ('b1d0a11a-0000-4000-8000-000000000104', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false),
  ('b1d0a11a-0000-4000-8000-000000000106', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false),
  ('b1d0a11a-0000-4000-8000-000000000107', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false),
  ('b1d0a11a-0000-4000-8000-000000000108', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false),
  ('b1d0a11a-0000-4000-8000-00000000019a', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false),
  ('b1d0a11a-0000-4000-8000-00000000019b', 'b1d0a11a-0000-4000-8000-0000000000b0', 'pipeline.view_all', false), -- admin da B, também desligado
  ('b1d0a11a-0000-4000-8000-00000000010a', 'b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', true);

-- ===========================================================================
-- (MX) matriz
-- ===========================================================================
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000001'), '01,02,03,04,05,07,08,09,10,11',
  'MX1: admin da A com a chave DESLIGADA ainda vê tudo da A (bypass por papel) e nada da B');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000002'), '01,02,03,04,05,07,08,09,10,11',
  'MX2: gestor de portfólio da A vê tudo da A');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000003'), '01,02,03,04,05,06,07,08,09,10,11',
  'MX3: master vê tudo, nas duas orgs');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000004'), '01,08,10',
  'MX4: membro SEM a chave vê o card do lead dele (E1), o card em que só o METADATA aponta para ele (E8, caixa alta) e o card atribuído a ele (E10); NÃO vê E2/E4/E9 (lead e card de outras pessoas) nem E11 (outro card do mesmo lead L10, da 05)');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000005'), '01,02,03,04,05,07,08,09,10,11',
  'MX5: membro COM a chave (default) vê tudo da A');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000006'), '02',
  'MX6: co-dono sem a chave vê o card do lead em que é co-dono (L2)');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000007'), '03',
  'MX7: atribuído só pelo card (assigned_to) vê esse card');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000008'), '',
  'MX8: sem dono nenhum não vê card algum (nem o lead sem dono, nem o card sem lead)');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-00000000000b'), '06',
  'MX9: membro da B vê só a B');
SELECT is(pg_temp.vistos_anon(), CASE WHEN has_table_privilege('anon', 'public.pipeline_entries', 'SELECT') THEN '' ELSE 'ERR:42501' END,
  'MX10: anon não vê card nenhum');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-00000000000a'), '01,02,03,04,05,07,08,09,10,11',
  'MX11: override do membro = true mantém a visão total');

-- (AD) bypass por ORG ----------------------------------------------------
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000009'), '05,06',
  'AD1: admin da B (chave desligada) e membro restrito da A: vê tudo da B e SÓ o card dele (L5) na A');

-- ===========================================================================
-- (CT) contador por etapa == lista
-- ===========================================================================
SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000004');
SET LOCAL role authenticated;
SELECT is(
  (SELECT COALESCE(sum(c.cnt), 0)::int
     FROM public.get_pipeline_stage_counts_by_id('b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-0000000000a0') c),
  (SELECT count(*)::int FROM public.negocio_projetado np
    WHERE np.pipeline_id = 'b1d0a11a-0000-4000-8000-0000000003a1' AND np.lead_id IS NOT NULL),
  'CT1: restrito — soma dos contadores da etapa == linhas da lista');
SELECT is(
  (SELECT COALESCE(sum(c.cnt), 0)::int
     FROM public.get_pipeline_stage_counts_by_id('b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-0000000000a0') c),
  3, 'CT2: e é 3 (E1, E8, E10 — os cards dele no funil), não 8');
SELECT is(
  (SELECT count(*)::int FROM public.get_pipeline_lead_ids(p_pipeline_id => 'b1d0a11a-0000-4000-8000-0000000003a1')),
  3, 'CT3: get_pipeline_lead_ids devolve só os leads dele (L1, L7, L10)');
RESET role;

SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000005');
SET LOCAL role authenticated;
SELECT is(
  (SELECT COALESCE(sum(c.cnt), 0)::int
     FROM public.get_pipeline_stage_counts_by_id('b1d0a11a-0000-4000-8000-0000000003a1', 'b1d0a11a-0000-4000-8000-0000000000a0') c),
  8, 'CT4: com a chave — 8 cards com lead no funil A (E7 não tem lead; E11 é de outro funil)');
RESET role;

-- ===========================================================================
-- (WR) escrita em card invisível
-- ===========================================================================
SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000004');
SET LOCAL role authenticated;
SELECT is(
  pg_temp.afetadas($q$UPDATE public.pipeline_entries SET notes = 'invadido'
               WHERE id = 'b1d0a11a-0000-4000-8000-000000000504'$q$),
  0, 'WR1: UPDATE em card invisível afeta 0 linhas');
SELECT is(
  pg_temp.afetadas($q$DELETE FROM public.pipeline_entries
               WHERE id = 'b1d0a11a-0000-4000-8000-000000000504'$q$),
  0, 'WR2: DELETE em card invisível afeta 0 linhas');
SELECT is(
  pg_temp.afetadas($q$UPDATE public.pipeline_entries SET notes = 'meu'
               WHERE id = 'b1d0a11a-0000-4000-8000-000000000501'$q$),
  1, 'WR3: UPDATE no card do próprio lead funciona');
RESET role;
SELECT is((SELECT notes FROM public.pipeline_entries WHERE id = 'b1d0a11a-0000-4000-8000-000000000504'), NULL,
  'WR4: o card invisível não foi tocado');

-- ===========================================================================
-- (RP) lead_tem_card_no_funil
-- ===========================================================================
SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000004');
SET LOCAL role authenticated;
SELECT is(public.lead_tem_card_no_funil('b1d0a11a-0000-4000-8000-000000000204', 'b1d0a11a-0000-4000-8000-0000000003a1'), true,
  'RP1: o restrito descobre que L4 já tem card no funil (que ele não enxerga)');
SELECT is(public.lead_tem_card_no_funil('b1d0a11a-0000-4000-8000-000000000204', 'b1d0a11a-0000-4000-8000-0000000003a1', true), true,
  'RP2: e que é um card aberto sem negócio (o que o índice único barra)');
SELECT is(public.lead_tem_card_no_funil('b1d0a11a-0000-4000-8000-000000000205', 'b1d0a11a-0000-4000-8000-0000000003a1', true), false,
  'RP3: card FECHADO não conta como "sem negócio aberto"');
SELECT is(public.lead_tem_card_no_funil('b1d0a11a-0000-4000-8000-000000000205', 'b1d0a11a-0000-4000-8000-0000000003a1'), true,
  'RP4: mas conta como "tem card no funil"');
SELECT is(public.lead_tem_card_no_funil('b1d0a11a-0000-4000-8000-000000000206', 'b1d0a11a-0000-4000-8000-0000000003b1'), false,
  'RP5: card de OUTRA org nunca é revelado');
SELECT is(public.lead_tem_card_no_funil(NULL, 'b1d0a11a-0000-4000-8000-0000000003a1'), false, 'RP6: lead NULL = false');
SELECT is(public.lead_tem_card_no_funil('b1d0a11a-0000-4000-8000-000000000201', NULL), false, 'RP7: funil NULL = false');
RESET role;

-- ===========================================================================
-- (AB) abrir_negocio
-- ===========================================================================
SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000004');
SET LOCAL role authenticated;
SELECT throws_ok(
  $q$SELECT public.abrir_negocio('b1d0a11a-0000-4000-8000-000000000204', 'whatsapp', 'novo_lead', NULL, NULL, NULL, NULL, NULL, 'human', NULL)$q$,
  '23505', 'lead_ja_no_funil: este lead já tem um card sem negócio neste funil, sob outro responsável.',
  'AB1: restrito abrindo negócio em lead cujo card ele não vê → recusa de domínio, não 23505 cego');
RESET role;

SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000001');
SET LOCAL role authenticated;
SELECT isnt(
  public.abrir_negocio('b1d0a11a-0000-4000-8000-000000000204', 'whatsapp', 'novo_lead', NULL, NULL, NULL, NULL, NULL, 'api', NULL),
  NULL, 'AB2: admin (vê o card) continua ADOTANDO o card sem negócio — comportamento de 20271118 intacto');
RESET role;
SELECT isnt((SELECT deal_id FROM public.pipeline_entries WHERE id = 'b1d0a11a-0000-4000-8000-000000000504'), NULL,
  'AB3: o negócio ficou ligado ao card que já existia (E4)');

-- ===========================================================================
-- (OD) default da ORG desligado + override do membro ligado
-- ===========================================================================
INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled)
VALUES ('b1d0a11a-0000-4000-8000-0000000000a0', 'pipeline.view_all', false);

SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000005'), '02,09,11',
  'OD1: política da org desliga a chave; membro sem override passa a ver só o dele (L2 e L8 por lead, E11 por estar no card)');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-00000000000a'), '01,02,03,04,05,07,08,09,10,11',
  'OD2: o override do membro (true) vence a política da org');
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000001'), '01,02,03,04,05,07,08,09,10,11',
  'OD3: admin segue vendo tudo');

DELETE FROM public.organization_feature_defaults
 WHERE organization_id = 'b1d0a11a-0000-4000-8000-0000000000a0' AND feature_key = 'pipeline.view_all';
SELECT is(pg_temp.vistos('b1d0a11a-0000-4000-8000-000000000005'), '01,02,03,04,05,07,08,09,10,11',
  'OD4: restaurar o padrão devolve a visão total');

-- ===========================================================================
-- (RT) Broadcast
-- ===========================================================================
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"realtime_broadcast_pe": true}'::jsonb
 WHERE id = 'b1d0a11a-0000-4000-8000-0000000000a0';

SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000004');
SELECT is(private.realtime_can_join('org:b1d0a11a-0000-4000-8000-0000000000a0:pe'), false,
  'RT1: Funil restrito NÃO entra no tópico Broadcast da org');
SELECT is(public.realtime_subscription_plan('b1d0a11a-0000-4000-8000-0000000000a0')->>'pipeline_entries', 'pg_changes',
  'RT2: e o plano do front é postgres_changes (que aplica a RLS por evento)');

SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000005');
SELECT is(private.realtime_can_join('org:b1d0a11a-0000-4000-8000-0000000000a0:pe'),
  to_regprocedure('private.strict_lead_member_orgs()') IS NOT NULL,
  'RT3: quem vê tudo entra (se o regime estrito #2298 existe; sem ele o join é fail-closed por 20271215030000)');

SELECT pg_temp.as_user('b1d0a11a-0000-4000-8000-000000000009');
SELECT is(private.realtime_can_join('org:b1d0a11a-0000-4000-8000-0000000000a0:pe'), false,
  'RT4: híbrido (admin na B, restrito na A) não entra no tópico da A');

SELECT * FROM finish();
ROLLBACK;
