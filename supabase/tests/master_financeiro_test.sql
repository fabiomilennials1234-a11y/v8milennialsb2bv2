-- supabase/tests/master_financeiro_test.sql
--
-- Guarda do financeiro da central Organizações (20271111000000):
--   - dinheiro só para master pleno (membro e outbounder barrados)
--   - tabelas sem acesso direto: tudo passa pelas RPCs
--   - mensalidade e custos auditados; NULL apaga o contrato
--   - vendas líquidas: estorno e sale_lost não contam
--   - chips: só Uazapi, conectado ou não
--   - folha (20271113000000): gravada, lida, preservada pela versão de 5 args
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/master_financeiro_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures
--   ORG        cliente
--   U_MEMBRO   membro da ORG
--   U_OUTB     master outbounder (permissions.all = false)
--   U_MASTER   master pleno
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;

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
  ('f1111111-0001-0000-0000-000000001111'::uuid, 'membro-fin@test.local'),
  ('f1111111-0002-0000-0000-000000001111'::uuid, 'outb-fin@test.local'),
  ('f1111111-0003-0000-0000-000000001111'::uuid, 'master-fin@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (id, user_id, is_active, permissions) VALUES
  ('f1111111-9992-0000-0000-000000001111', 'f1111111-0002-0000-0000-000000001111', true, '{"all": false}'),
  ('f1111111-9993-0000-0000-000000001111', 'f1111111-0003-0000-0000-000000001111', true, '{"all": true}')
ON CONFLICT (user_id) DO UPDATE SET is_active = true, permissions = EXCLUDED.permissions;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('f1111111-aaaa-0000-0000-000000001111', 'Org Financeiro', 'org-fin-1111', 'America/Sao_Paulo');

SET LOCAL session_replication_role = replica;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES ('f1111111-1111-0000-0000-000000001111', 'f1111111-aaaa-0000-0000-000000001111',
        'f1111111-0001-0000-0000-000000001111', 'Membro', 'admin', true);

INSERT INTO public.leads (id, organization_id, name)
VALUES ('f1111111-1eae-0000-0000-000000001111', 'f1111111-aaaa-0000-0000-000000001111', 'Lead Fin');

-- 3 vendas no período: uma estornada, uma sale_lost; e uma antiga (fora dos 30 dias).
INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, sold_at, sale_value,
                                revenue_stream, producer, origin_record_id, reversed_event_id) VALUES
  ('f1111111-5a1e-0000-0000-000000000001', 'f1111111-aaaa-0000-0000-000000001111', 'f1111111-1eae-0000-0000-000000001111',
   'sale', now() - interval '2 days', 1000, 'carteira', 'carteira', gen_random_uuid(), NULL),
  ('f1111111-5a1e-0000-0000-000000000002', 'f1111111-aaaa-0000-0000-000000001111', 'f1111111-1eae-0000-0000-000000001111',
   'sale', now() - interval '3 days', 500, 'carteira', 'carteira', gen_random_uuid(), NULL),
  ('f1111111-5a1e-0000-0000-000000000003', 'f1111111-aaaa-0000-0000-000000001111', 'f1111111-1eae-0000-0000-000000001111',
   'sale_reversed', now() - interval '1 day', 500, 'carteira', 'carteira', gen_random_uuid(),
   'f1111111-5a1e-0000-0000-000000000002'),
  ('f1111111-5a1e-0000-0000-000000000004', 'f1111111-aaaa-0000-0000-000000001111', 'f1111111-1eae-0000-0000-000000001111',
   'sale_lost', now() - interval '1 day', 700, 'carteira', 'carteira', gen_random_uuid(), NULL),
  ('f1111111-5a1e-0000-0000-000000000005', 'f1111111-aaaa-0000-0000-000000001111', 'f1111111-1eae-0000-0000-000000001111',
   'sale', now() - interval '40 days', 9000, 'carteira', 'carteira', gen_random_uuid(), NULL);

INSERT INTO public.whatsapp_instances (organization_id, instance_name, provider, status) VALUES
  ('f1111111-aaaa-0000-0000-000000001111', 'fin-uaz-1', 'uazapi', 'connected'),
  ('f1111111-aaaa-0000-0000-000000001111', 'fin-uaz-2', 'uazapi', 'disconnected'),
  ('f1111111-aaaa-0000-0000-000000001111', 'fin-evo-1', 'evolution', 'connected');

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) Estrutura: sem acesso direto às tabelas
-- ---------------------------------------------------------------------------
SELECT is(has_table_privilege('authenticated', 'public.org_billing', 'SELECT'), false,
  '(a) authenticated não lê org_billing direto');
SELECT is(has_table_privilege('authenticated', 'public.master_cost_settings', 'SELECT'), false,
  '(a) authenticated não lê master_cost_settings direto');
SELECT is((SELECT count(*)::int FROM public.master_cost_settings), 1,
  '(a) master_cost_settings nasce com a linha única');

-- ---------------------------------------------------------------------------
-- (b) Membro e outbounder não veem dinheiro
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1111111-0001-0000-0000-000000001111","role":"authenticated"}', true);

SELECT throws_ok($$ SELECT * FROM public.master_org_finance() $$, '42501', NULL,
  '(b) membro não lê o financeiro');
SELECT throws_ok($$ SELECT * FROM public.master_get_cost_settings() $$, '42501', NULL,
  '(b) membro não lê os custos');
SELECT throws_ok($$ SELECT public.master_set_org_monthly_fee('f1111111-aaaa-0000-0000-000000001111', 100, NULL) $$,
  '42501', NULL, '(b) membro não define mensalidade');
SELECT throws_ok($$ SELECT public.master_set_cost_settings(1, 1, 1, 1, 1) $$, '42501', NULL,
  '(b) membro não define custos');
SELECT throws_ok($$ SELECT public.master_set_cost_settings(1, 1, 1, 1, 1, 1) $$, '42501', NULL,
  '(b) membro não define custos nem pela versão com folha');

SELECT set_config('request.jwt.claims',
  '{"sub":"f1111111-0002-0000-0000-000000001111","role":"authenticated"}', true);

SELECT throws_ok($$ SELECT * FROM public.master_org_finance() $$, '42501', NULL,
  '(b) outbounder não lê o financeiro');
SELECT throws_ok($$ SELECT public.master_set_org_monthly_fee('f1111111-aaaa-0000-0000-000000001111', 100, NULL) $$,
  '42501', NULL, '(b) outbounder não define mensalidade');

-- ---------------------------------------------------------------------------
-- (c) Master pleno: fatos
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"f1111111-0003-0000-0000-000000001111","role":"authenticated"}', true);

SELECT is(
  (SELECT client_revenue_30d FROM public.master_org_finance() WHERE organization_id = 'f1111111-aaaa-0000-0000-000000001111'),
  1000::numeric, '(c) receita 30d: estorno, sale_lost e venda antiga ficam fora');
SELECT is(
  (SELECT client_sales_30d FROM public.master_org_finance() WHERE organization_id = 'f1111111-aaaa-0000-0000-000000001111'),
  1, '(c) uma venda líquida no período');
SELECT is(
  (SELECT uazapi_chips FROM public.master_org_finance() WHERE organization_id = 'f1111111-aaaa-0000-0000-000000001111'),
  2, '(c) chips: só Uazapi, conectado ou não');
SELECT is(
  (SELECT monthly_fee_cents FROM public.master_org_finance() WHERE organization_id = 'f1111111-aaaa-0000-0000-000000001111'),
  NULL::integer, '(c) sem contrato, mensalidade vem NULL (a tela estima)');

-- ---------------------------------------------------------------------------
-- (d) Mensalidade: escrita, validação, auditoria, remoção
-- ---------------------------------------------------------------------------
SELECT lives_ok($$ SELECT public.master_set_org_monthly_fee('f1111111-aaaa-0000-0000-000000001111', 199700, 'contrato anual') $$,
  '(d) master define a mensalidade');
SELECT is(
  (SELECT monthly_fee_cents FROM public.master_org_finance() WHERE organization_id = 'f1111111-aaaa-0000-0000-000000001111'),
  199700, '(d) mensalidade aparece no financeiro');
SELECT throws_ok($$ SELECT public.master_set_org_monthly_fee('f1111111-aaaa-0000-0000-000000001111', -1, NULL) $$,
  '22023', NULL, '(d) mensalidade negativa é rejeitada');
SELECT throws_ok($$ SELECT public.master_set_org_monthly_fee('f1111111-dead-0000-0000-000000001111', 100, NULL) $$,
  '22023', NULL, '(d) org inexistente é rejeitada');
SELECT lives_ok($$ SELECT public.master_set_org_monthly_fee('f1111111-aaaa-0000-0000-000000001111', NULL, NULL) $$,
  '(d) NULL apaga o contrato');
SELECT is(
  (SELECT monthly_fee_cents FROM public.master_org_finance() WHERE organization_id = 'f1111111-aaaa-0000-0000-000000001111'),
  NULL::integer, '(d) sem contrato de novo');

-- ---------------------------------------------------------------------------
-- (e) Custos
-- ---------------------------------------------------------------------------
SELECT lives_ok($$ SELECT public.master_set_cost_settings(4900, 500000, 0.40, 1.60, 5.45) $$,
  '(e) master define os custos');
SELECT throws_ok($$ SELECT public.master_set_cost_settings(-1, 0, 0, 0, 0) $$, '23514', NULL,
  '(e) custo negativo é rejeitado');

-- ---------------------------------------------------------------------------
-- (f) Salários (20271113000000)
-- ---------------------------------------------------------------------------
SELECT lives_ok($$ SELECT public.master_set_cost_settings(4900, 500000, 4000000, 0.40, 1.60, 5.45) $$,
  '(f) master grava a folha');
SELECT is((SELECT payroll_monthly_cents FROM public.master_get_cost_settings()), 4000000,
  '(f) a folha volta na leitura');
SELECT lives_ok($$ SELECT public.master_set_cost_settings(5000, 500000, 0.40, 1.60, 5.45) $$,
  '(f) a versão de 5 argumentos (front antigo) segue funcionando');
SELECT is((SELECT payroll_monthly_cents FROM public.master_get_cost_settings()), 4000000,
  '(f) a versão de 5 argumentos preserva a folha gravada');
SELECT throws_ok($$ SELECT public.master_set_cost_settings(0, 0, -1, 0, 0, 0) $$, '23514', NULL,
  '(f) folha negativa é rejeitada');

SET LOCAL role postgres;
SELECT is(
  (SELECT count(*)::int FROM public.master_audit_logs
    WHERE (action = 'ORG_MONTHLY_FEE' AND target_id = 'f1111111-aaaa-0000-0000-000000001111')
       OR (action = 'COST_SETTINGS' AND user_id = 'f1111111-0003-0000-0000-000000001111')),
  5, '(e/f) duas mudanças de mensalidade e três de custo auditadas');

SELECT * FROM finish();
ROLLBACK;
