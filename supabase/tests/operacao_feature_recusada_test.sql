-- supabase/tests/operacao_feature_recusada_test.sql
--
-- Guarda da coluna "Feature recusada" no kanban da Operação
-- (migrations 20271117000000 + 20271117000100):
--   - só chamado diagnosticado como `feature` entra em recusada;
--   - `recusado` é terminal: cliente não reabre, UPDATE direto não entra nem sai;
--   - o master tira de recusado pela RPC, sem contar reabertura;
--   - relógio: recusado tem closed_at e não tem resolved_at;
--   - recusado não conta como chamado aberto nos sinais de saúde da org.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/operacao_feature_recusada_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures
--   U_MEMBRO  autor dos chamados, admin da ORG
--   U_MASTER  master que move
--   Chamados (status inicial · diagnóstico):
--     01 aberto · feature        → recusada, depois volta para Em andamento
--     02 aberto · fix            → recusada é negada
--     03 aberto · sem diagnóstico → recusada é negada
--     04 em_andamento · feature  → master tenta UPDATE direto para recusado
--     05 fechado · feature       → recusada (Concluído → Feature recusada)
--     06 recusado · feature      → cliente tenta reabrir; depois Concluído
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
  ('a5de1117-0001-0000-0000-000000001117'::uuid, 'membro-1117@test.local'),
  ('a5de1117-0003-0000-0000-000000001117'::uuid, 'master-1117@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (id, user_id, is_active, permissions)
VALUES ('a5de1117-9999-0000-0000-000000001117', 'a5de1117-0003-0000-0000-000000001117', true, '{"all": true}')
ON CONFLICT (user_id) DO UPDATE SET is_active = true, permissions = '{"all": true}';

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('a5de1117-aaaa-0000-0000-000000001117', 'Org Recusa', 'org-recusa-1117', 'America/Sao_Paulo');

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES ('a5de1117-1111-0000-0000-000000001117', 'a5de1117-aaaa-0000-0000-000000001117',
        'a5de1117-0001-0000-0000-000000001117', 'Membro', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.support_tickets (
  id, organization_id, author_user_id, title, description, tipo, impacto, status, resolved_at, closed_at
)
SELECT t.id, 'a5de1117-aaaa-0000-0000-000000001117', 'a5de1117-0001-0000-0000-000000001117',
       'Chamado de teste ' || right(t.id::text, 2), 'x', 'solicitacao', 'incomodo', t.status::public.support_ticket_status,
       t.resolved_at, t.closed_at
FROM (VALUES
  ('a5de1117-cccc-0000-0000-000000000001'::uuid, 'aberto',       NULL::timestamptz, NULL::timestamptz),
  ('a5de1117-cccc-0000-0000-000000000002'::uuid, 'aberto',       NULL, NULL),
  ('a5de1117-cccc-0000-0000-000000000003'::uuid, 'aberto',       NULL, NULL),
  ('a5de1117-cccc-0000-0000-000000000004'::uuid, 'em_andamento', NULL, NULL),
  ('a5de1117-cccc-0000-0000-000000000005'::uuid, 'fechado',      now() - interval '10 days', now() - interval '3 days'),
  ('a5de1117-cccc-0000-0000-000000000006'::uuid, 'recusado',     NULL, now() - interval '2 days')
) AS t(id, status, resolved_at, closed_at);

INSERT INTO public.support_ticket_diagnoses (
  ticket_id, kind, complexity, summary, customer_reply, recommended_model,
  recommended_effort, resolution_prompt, keystones
)
SELECT t.id, t.kind, 'media', 'Diagnóstico de teste com dez+', NULL, 'sonnet', 'medium',
       repeat('prompt de resolução ', 5), '[{"label":"ok","verify":"select 1"}]'
FROM (VALUES
  ('a5de1117-cccc-0000-0000-000000000001'::uuid, 'feature'),
  ('a5de1117-cccc-0000-0000-000000000002'::uuid, 'fix'),
  ('a5de1117-cccc-0000-0000-000000000004'::uuid, 'feature'),
  ('a5de1117-cccc-0000-0000-000000000005'::uuid, 'feature'),
  ('a5de1117-cccc-0000-0000-000000000006'::uuid, 'feature')
) AS t(id, kind);

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) O estado existe
-- ---------------------------------------------------------------------------
SELECT ok('recusado' = ANY (enum_range(NULL::public.support_ticket_status)::text[]),
  '(a) support_ticket_status tem recusado');

-- ---------------------------------------------------------------------------
-- (b) Cliente: recusado é terminal
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5de1117-0001-0000-0000-000000001117","role":"authenticated"}', true);

SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'aberto'
                     WHERE id = 'a5de1117-cccc-0000-0000-000000000006' $$,
  '23514', NULL, '(b) cliente não reabre recusado');

SELECT set_config('torque.support_staff_move', 'on', true);
SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'aberto'
                     WHERE id = 'a5de1117-cccc-0000-0000-000000000006' $$,
  '23514', NULL, '(b) cliente com a variável ligada também não');
SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'recusado'
                     WHERE id = 'a5de1117-cccc-0000-0000-000000000004' $$,
  '23514', NULL, '(b) cliente não recusa');
SELECT set_config('torque.support_staff_move', 'off', true);

SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000001', 'recusada') $$,
  '42501', NULL, '(b) cliente não chama a RPC');

-- ---------------------------------------------------------------------------
-- (c) Master: só feature entra em recusada
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"a5de1117-0003-0000-0000-000000001117","role":"authenticated"}', true);

SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000002', 'recusada') $$,
  '23514', 'so um chamado diagnosticado como feature pode ser recusado', '(c) fix não é recusado');
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000003', 'recusada') $$,
  '23514', 'so um chamado diagnosticado como feature pode ser recusado', '(c) sem diagnóstico não é recusado');

-- UPDATE direto do master, fora da RPC: não recusa.
SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'recusado'
                     WHERE id = 'a5de1117-cccc-0000-0000-000000000004' $$,
  '23514', NULL, '(c) master não recusa por UPDATE direto');

SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000001', 'recusada') $$,
  '(c) feature aberta → Feature recusada');

SET LOCAL role postgres;
SELECT is((SELECT status::text FROM public.support_tickets WHERE id = 'a5de1117-cccc-0000-0000-000000000001'),
  'recusado', '(c) estado gravado: recusado');
SELECT ok((SELECT closed_at IS NOT NULL AND resolved_at IS NULL FROM public.support_tickets
            WHERE id = 'a5de1117-cccc-0000-0000-000000000001'),
  '(c) relógio: closed_at carimbado, resolved_at vazio');
SELECT is((SELECT details ->> 'to_column' FROM public.master_audit_logs
            WHERE target_id = 'a5de1117-cccc-0000-0000-000000000001' AND action = 'SUPPORT_TICKET_MOVE'
            ORDER BY created_at DESC LIMIT 1),
  'recusada', '(c) movimento auditado com a coluna');

-- Direto do master também não tira de recusado.
SET LOCAL role authenticated;
SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'aberto'
                     WHERE id = 'a5de1117-cccc-0000-0000-000000000001' $$,
  '23514', NULL, '(c) master não tira de recusado por UPDATE direto');
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000001', 'recusada') $$,
  '23514', NULL, '(c) já está em Feature recusada');

-- ---------------------------------------------------------------------------
-- (d) Master: sai de recusada pela RPC, sem contar reabertura
-- ---------------------------------------------------------------------------
SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000001', 'andamento') $$,
  '(d) Feature recusada → Em andamento');

SET LOCAL role postgres;
SELECT is((SELECT status::text FROM public.support_tickets WHERE id = 'a5de1117-cccc-0000-0000-000000000001'),
  'em_andamento', '(d) voltou ao trabalho');
SELECT ok((SELECT closed_at IS NULL AND reopen_count = 0 FROM public.support_tickets
            WHERE id = 'a5de1117-cccc-0000-0000-000000000001'),
  '(d) closed_at limpo e reabertura não contada');

-- Concluído ↔ Feature recusada: o carimbo é o do movimento, nunca vazio.
SET LOCAL role authenticated;
SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000005', 'recusada') $$,
  '(d) Concluído → Feature recusada');
SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1117-cccc-0000-0000-000000000006', 'concluido') $$,
  '(d) Feature recusada → Concluído');

SET LOCAL role postgres;
SELECT ok((SELECT status = 'recusado' AND closed_at > now() - interval '1 minute' AND resolved_at IS NULL
             FROM public.support_tickets WHERE id = 'a5de1117-cccc-0000-0000-000000000005'),
  '(d) fechado → recusado: closed_at do movimento, resolved_at vazio');
SELECT ok((SELECT status = 'fechado' AND closed_at > now() - interval '1 minute' AND resolved_at IS NOT NULL
             FROM public.support_tickets WHERE id = 'a5de1117-cccc-0000-0000-000000000006'),
  '(d) recusado → fechado: closed_at do movimento');

-- ---------------------------------------------------------------------------
-- (e) Recusado é encerrado para quem conta e para quem limpa
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
-- 01 em_andamento, 02 e 03 abertos, 04 em_andamento → 4; 05 recusado e 06 fechado não contam.
SELECT is((SELECT open_tickets FROM public.master_org_health_signals()
            WHERE organization_id = 'a5de1117-aaaa-0000-0000-000000001117'),
  4, '(e) sinais de saúde: recusado não é chamado aberto');

SET LOCAL role postgres;
SELECT ok((SELECT prosrc LIKE '%''recusado''%' FROM pg_proc
            WHERE oid = 'public.purge_expired_support_attachments()'::regprocedure),
  '(e) retenção de anexos cobre recusado');

SELECT * FROM finish();
ROLLBACK;
