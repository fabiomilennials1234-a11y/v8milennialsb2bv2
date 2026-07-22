-- supabase/tests/duplicate_leads_rpcs_test.sql
--
-- Backend que faltava para a página /duplicados (migration
-- 20270725000000_duplicate_leads_rpcs.sql): find_duplicate_leads(p_org) +
-- merge_leads(p_keep_lead_id, p_merge_lead_id).
--
-- Run:
--   psql "$DATABASE_URL" -f supabase/tests/duplicate_leads_rpcs_test.sql
--   (ou via pg_prove / supabase test db — roda dentro de rollback)
--
-- Asserts:
--   (a) estrutura + grants: funções existem; EXECUTE só p/ authenticated
--       (REVOKE FROM PUBLIC + REVOKE FROM anon explícito → anon NÃO executa);
--       índice composite idx_leads_org_name_trgm existe
--   (b) find casa por phone / email (case-insensitive) / name (trigram),
--       1 linha por par (a.id < b.id), ignora deleted_at
--   (c) MULTI-TENANT: org explícita validada (assert_org_access) — membro de
--       outra org é BLOQUEADO; sem par cross-org
--   (d) merge: guard p_keep<>p_merge, guard cross-tenant, IDOR (access_denied),
--       happy path re-aponta FK + deleta o absorvido, e pre-dedupe DATA-DRIVEN
--       resolve a colisão UNIQUE(pipeline_id, lead_id) (par no mesmo pipe → o
--       caso comum que ABORTAVA o merge antes do fix)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(23);

-- ---------------------------------------------------------------------------
-- (a) Estrutura + grants
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'find_duplicate_leads', ARRAY['uuid'],
  '(a) find_duplicate_leads(uuid) existe');

SELECT has_function('public', 'merge_leads', ARRAY['uuid', 'uuid'],
  '(a) merge_leads(uuid,uuid) existe');

SELECT ok(
  has_function_privilege('authenticated', 'public.find_duplicate_leads(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.merge_leads(uuid,uuid)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated nas duas RPCs');

SELECT ok(
  NOT has_function_privilege('anon', 'public.find_duplicate_leads(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.merge_leads(uuid,uuid)', 'EXECUTE'),
  '(a) anon NÃO executa (REVOKE FROM PUBLIC + REVOKE FROM anon explícito) — sem enumerar PII');

-- [FIX-2] índice do match por nome = COMPOSITE idx_leads_org_name_trgm
-- (organization_id, name gin_trgm_ops), não mais o single-col idx_leads_name_trgm.
SELECT has_index('public', 'leads', 'idx_leads_org_name_trgm',
  '(a) índice composite idx_leads_org_name_trgm existe (perf do match por nome)');

-- ---------------------------------------------------------------------------
-- Fixtures: 2 orgs, 2 usuários/membros, leads com duplicatas plantadas.
-- Triggers OFF no seed (replica) p/ evitar cascatas (stage events, dispatch).
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('dddddddd-0000-0000-0000-00000000000a', 'Org A dup-test', 'org-a-dup-test'),
  ('dddddddd-0000-0000-0000-00000000000b', 'Org B dup-test', 'org-b-dup-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('dddddddd-1111-0000-0000-00000000000a', 'user-a-dup@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('dddddddd-1111-0000-0000-00000000000b', 'user-b-dup@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('dddddddd-2222-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-00000000000a',
   'dddddddd-1111-0000-0000-00000000000a', 'Membro A', 'admin', true),
  ('dddddddd-2222-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-00000000000b',
   'dddddddd-1111-0000-0000-00000000000b', 'Membro B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

-- Org A:
--  a1: âncora — phone P, email E, nome "Distribuidora Acme LTDA"
--  a2: mesmo phone P (→ phone match c/ a1)
--  a3: nome quase igual ao de a1 (→ name match), email E2
--  a4: email E2 em MAIÚSCULA (→ email match c/ a3, case-insensitive)
--  a5: SOFT-DELETED, mesmo phone P + mesmo nome (→ NÃO pode aparecer)
INSERT INTO public.leads (id, organization_id, name, normalized_phone, email, deleted_at)
VALUES
  ('dddddddd-aaaa-0000-0000-000000000001', 'dddddddd-0000-0000-0000-00000000000a',
   'Distribuidora Acme LTDA', '5511999990000', 'contato@acme.com', NULL),
  ('dddddddd-aaaa-0000-0000-000000000002', 'dddddddd-0000-0000-0000-00000000000a',
   'Outro Nome Qualquer', '5511999990000', NULL, NULL),
  ('dddddddd-aaaa-0000-0000-000000000003', 'dddddddd-0000-0000-0000-00000000000a',
   'Distribuidora Acme Ltda', '5511911112222', 'vendas@beta.com', NULL),
  ('dddddddd-aaaa-0000-0000-000000000004', 'dddddddd-0000-0000-0000-00000000000a',
   'Empresa Beta Comercio', '5511933334444', 'VENDAS@BETA.COM', NULL),
  ('dddddddd-aaaa-0000-0000-000000000005', 'dddddddd-0000-0000-0000-00000000000a',
   'Distribuidora Acme LTDA', '5511999990000', 'contato@acme.com', now())
ON CONFLICT (id) DO NOTHING;

-- Org B: clone idêntico de a1 — MESMO phone/email/nome, org diferente.
INSERT INTO public.leads (id, organization_id, name, normalized_phone, email, deleted_at)
VALUES
  ('dddddddd-bbbb-0000-0000-000000000001', 'dddddddd-0000-0000-0000-00000000000b',
   'Distribuidora Acme LTDA', '5511999990000', 'contato@acme.com', NULL)
ON CONFLICT (id) DO NOTHING;

-- Pipeline compartilhado + entries de a1 E a2 no MESMO pipeline → colisão
-- UNIQUE(pipeline_id, lead_id) [PARCIAL: WHERE lead_id IS NOT NULL]. É o caso
-- comum que abortava o merge antes do pre-dedupe data-driven.
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('dddddddd-9999-0000-0000-000000000001', 'dddddddd-0000-0000-0000-00000000000a',
        'Pipe dup-test', 'pipe-dup-test', 'custom')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES
  ('dddddddd-7777-0000-0000-000000000001', 'dddddddd-0000-0000-0000-00000000000a',
   'dddddddd-9999-0000-0000-000000000001', 'dddddddd-aaaa-0000-0000-000000000001', 'novo'),
  ('dddddddd-7777-0000-0000-000000000002', 'dddddddd-0000-0000-0000-00000000000a',
   'dddddddd-9999-0000-0000-000000000001', 'dddddddd-aaaa-0000-0000-000000000002', 'novo')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (b) find_duplicate_leads — contexto: Membro A, org A explícita
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-1111-0000-0000-00000000000a","role":"authenticated"}', true);

-- Exatamente 3 pares: (a1,a2) phone, (a3,a4) email, (a1,a3) name.
SELECT is(
  (SELECT count(*)::int FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')),
  3, '(b) Membro A vê exatamente 3 pares duplicados');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')
    WHERE lead_a_id = 'dddddddd-aaaa-0000-0000-000000000001'
      AND lead_b_id = 'dddddddd-aaaa-0000-0000-000000000002'
      AND match_type = 'phone'
      AND similarity = 1.0
  ),
  '(b) par por telefone normalizado (a1↔a2), similarity 1.0');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')
    WHERE lead_a_id = 'dddddddd-aaaa-0000-0000-000000000003'
      AND lead_b_id = 'dddddddd-aaaa-0000-0000-000000000004'
      AND match_type = 'email'
  ),
  '(b) par por email case-insensitive (a3↔a4)');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')
    WHERE lead_a_id = 'dddddddd-aaaa-0000-0000-000000000001'
      AND lead_b_id = 'dddddddd-aaaa-0000-0000-000000000003'
      AND match_type = 'name'
      AND similarity >= 0.6 AND similarity <= 1.0
  ),
  '(b) par por nome similar / trigram (a1↔a3), 0.6 ≤ sim ≤ 1');

SELECT is(
  (SELECT count(*)::int FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')
    WHERE 'dddddddd-aaaa-0000-0000-000000000005' IN (lead_a_id, lead_b_id)),
  0, '(b) lead soft-deleted (a5) NUNCA aparece (deleted_at IS NULL)');

SELECT is(
  (SELECT bool_and(lead_a_id < lead_b_id)::boolean
     FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')),
  true, '(b) cada par vem uma vez (a.id < b.id, sem A↔B e B↔A)');

-- ---------------------------------------------------------------------------
-- (c) Multi-tenant
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a')
    WHERE 'dddddddd-bbbb-0000-0000-000000000001' IN (lead_a_id, lead_b_id)),
  0, '(c) clone da org B NÃO aparece no resultado da org A');

-- Membro B na SUA org: só 1 lead → 0 duplicatas
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-1111-0000-0000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000b')),
  0, '(c) Membro B na própria org: 0 duplicatas');

-- Membro B pedindo a org A → assert_org_access BLOQUEIA (não confia no body)
SELECT throws_ok(
  $$ SELECT public.find_duplicate_leads('dddddddd-0000-0000-0000-00000000000a') $$,
  'P0001', NULL,
  '(c) Membro B pedindo org A é BLOQUEADO (assert_org_access) — sem firehose');

-- ---------------------------------------------------------------------------
-- (d) merge_leads
-- ---------------------------------------------------------------------------

-- Guard: mesmo lead dos dois lados (contexto Membro A)
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-1111-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.merge_leads(
       'dddddddd-aaaa-0000-0000-000000000001',
       'dddddddd-aaaa-0000-0000-000000000001') $$,
  'P0001', NULL,
  '(d) guard: mesclar um lead nele mesmo FALHA');

-- Guard cross-tenant: keep na org A, merge na org B
SELECT throws_ok(
  $$ SELECT public.merge_leads(
       'dddddddd-aaaa-0000-0000-000000000001',
       'dddddddd-bbbb-0000-0000-000000000001') $$,
  'P0001', NULL,
  '(d) guard: leads de orgs diferentes NÃO podem ser mesclados');

-- IDOR: Membro B tentando mesclar dois leads da org A → access_denied
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-1111-0000-0000-00000000000b","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.merge_leads(
       'dddddddd-aaaa-0000-0000-000000000001',
       'dddddddd-aaaa-0000-0000-000000000002') $$,
  'P0001', NULL,
  '(d) IDOR: membro sem acesso à org é BLOQUEADO (assert_org_access)');

-- Happy path (Membro A): a1 e a2 compartilham pipeline P (colisão UNIQUE) +
-- lead_history em a2. O merge só CONCLUI se o pre-dedupe data-driven resolver
-- a colisão pipeline_entries; a lead_history (ON DELETE CASCADE) só sobrevive
-- apontando p/ a1 se o re-aponta (passo 5) rodar.
SET LOCAL role postgres;
INSERT INTO public.lead_history (id, lead_id, action, description)
VALUES ('dddddddd-eeee-0000-0000-000000000001',
        'dddddddd-aaaa-0000-0000-000000000002', 'test', 'fk repoint probe');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-1111-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.merge_leads(
       'dddddddd-aaaa-0000-0000-000000000001',
       'dddddddd-aaaa-0000-0000-000000000002') $$,
  '(d) merge a2→a1 CONCLUI apesar da colisão UNIQUE(pipeline_id,lead_id)');

SET LOCAL role postgres;

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.leads
              WHERE id = 'dddddddd-aaaa-0000-0000-000000000002'),
  '(d) lead absorvido (a2) foi deletado');

SELECT ok(
  EXISTS (SELECT 1 FROM public.leads
          WHERE id = 'dddddddd-aaaa-0000-0000-000000000001'),
  '(d) lead mantido (a1) segue vivo');

SELECT is(
  (SELECT lead_id FROM public.lead_history
    WHERE id = 'dddddddd-eeee-0000-0000-000000000001'),
  'dddddddd-aaaa-0000-0000-000000000001'::uuid,
  '(d) FK re-apontada: lead_history de a2 agora aponta p/ a1 (não cascadeou)');

-- pre-dedupe: entry de a2 no pipe P foi removida (colidia); só a de a1 fica.
SELECT is(
  (SELECT count(*)::int FROM public.pipeline_entries
    WHERE pipeline_id = 'dddddddd-9999-0000-0000-000000000001'),
  1, '(d) pre-dedupe: 1 entry no pipe P (a de a2 deduplicada, sem unique_violation)');

SELECT is(
  (SELECT lead_id FROM public.pipeline_entries
    WHERE pipeline_id = 'dddddddd-9999-0000-0000-000000000001'),
  'dddddddd-aaaa-0000-0000-000000000001'::uuid,
  '(d) a entry remanescente no pipe P é a do lead mantido (a1)');

SELECT * FROM finish();

ROLLBACK;
