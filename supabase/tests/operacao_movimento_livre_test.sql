-- supabase/tests/operacao_movimento_livre_test.sql
--
-- Guarda do movimento livre do master no kanban da Operação
-- (migration 20271108000300, emenda ao ADR-0018):
--   - só master move, e só pela RPC `master_ticket_move` (auditada);
--   - o cliente continua só reabrindo resolvido → aberto — inclusive se ligar
--     a variável de sessão que a RPC usa;
--   - UPDATE direto de status pelo master segue as regras de antes;
--   - mover não conta reabertura; o relógio (resolved_at/closed_at) é do banco.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/operacao_movimento_livre_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(40);

-- ---------------------------------------------------------------------------
-- Fixtures
--   U_MEMBRO  autor dos chamados, admin da ORG
--   U_MASTER  master que move
--   M_OUTRO   outro master (dono pré-existente de um chamado)
--   Chamados (status inicial):
--     01 aberto, sem diagnóstico        → fecha direto (aberto → Concluído)
--     02 resolvido, reopen_count 0      → volta para Chamado aberto sem contar
--     03 em_andamento, sem diagnóstico  → send_reply sem resposta falha
--     04 em_andamento, com resposta     → send_reply envia + Resolvido
--     05 em_andamento, com resposta     → só muda o estado, sem enviar
--     06 resolvido                      → o cliente reabre (conta reabertura)
--     07 em_andamento                   → cliente tenta fechar com a variável ligada
--     08 aberto c/ diagnóstico, dono M_OUTRO → Em andamento mantém o dono
--     09 aberto, sem diagnóstico        → master tenta UPDATE direto
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
  ('a5de1108-0001-0000-0000-000000001108'::uuid, 'membro-1108@test.local'),
  ('a5de1108-0003-0000-0000-000000001108'::uuid, 'master-1108@test.local'),
  ('a5de1108-0004-0000-0000-000000001108'::uuid, 'outro-master-1108@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (id, user_id, is_active, permissions)
VALUES
  ('a5de1108-9999-0000-0000-000000001108', 'a5de1108-0003-0000-0000-000000001108', true, '{"all": true}'),
  ('a5de1108-9998-0000-0000-000000001108', 'a5de1108-0004-0000-0000-000000001108', true, '{"all": true}')
ON CONFLICT (user_id) DO UPDATE SET is_active = true, permissions = '{"all": true}';

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('a5de1108-aaaa-0000-0000-000000001108', 'Org Operação', 'org-op-1108', 'America/Sao_Paulo');

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES ('a5de1108-1111-0000-0000-000000001108', 'a5de1108-aaaa-0000-0000-000000001108',
        'a5de1108-0001-0000-0000-000000001108', 'Membro', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.support_tickets (
  id, organization_id, author_user_id, title, description, tipo, impacto, status,
  resolved_at, assigned_master_user_id
)
VALUES
  ('a5de1108-cccc-0000-0000-000000000001', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 01', 'x', 'bug', 'contorno', 'aberto', NULL, NULL),
  ('a5de1108-cccc-0000-0000-000000000002', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 02', 'x', 'bug', 'contorno', 'resolvido', now() - interval '1 day', NULL),
  ('a5de1108-cccc-0000-0000-000000000003', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 03', 'x', 'bug', 'contorno', 'em_andamento', NULL, NULL),
  ('a5de1108-cccc-0000-0000-000000000004', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 04', 'x', 'bug', 'contorno', 'em_andamento', NULL, NULL),
  ('a5de1108-cccc-0000-0000-000000000005', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 05', 'x', 'bug', 'contorno', 'em_andamento', NULL, NULL),
  ('a5de1108-cccc-0000-0000-000000000006', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 06', 'x', 'bug', 'contorno', 'resolvido', now() - interval '1 day', NULL),
  ('a5de1108-cccc-0000-0000-000000000007', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 07', 'x', 'bug', 'contorno', 'em_andamento', NULL, NULL),
  ('a5de1108-cccc-0000-0000-000000000008', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 08', 'x', 'bug', 'contorno', 'aberto', NULL, 'a5de1108-9998-0000-0000-000000001108'),
  ('a5de1108-cccc-0000-0000-000000000009', 'a5de1108-aaaa-0000-0000-000000001108', 'a5de1108-0001-0000-0000-000000001108',
   'Chamado de teste 09', 'x', 'bug', 'contorno', 'aberto', NULL, NULL);

INSERT INTO public.support_ticket_diagnoses (
  ticket_id, kind, complexity, summary, customer_reply, recommended_model,
  recommended_effort, resolution_prompt, keystones
)
SELECT t.id, 'fix', 'baixa', 'Diagnóstico de teste com dez+', t.reply, 'sonnet', 'medium',
       repeat('prompt de resolução ', 5), '[{"label":"ok","verify":"select 1"}]'
FROM (VALUES
  ('a5de1108-cccc-0000-0000-000000000004'::uuid, 'Corrigimos o problema.'),
  ('a5de1108-cccc-0000-0000-000000000005'::uuid, 'Corrigimos o problema.'),
  ('a5de1108-cccc-0000-0000-000000000008'::uuid, NULL)
) AS t(id, reply);

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) A porta: existe, e anon não entra
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'master_ticket_move', ARRAY['uuid', 'text', 'boolean'],
  '(a) master_ticket_move existe');
SELECT is(has_function_privilege('anon', 'public.master_ticket_move(uuid, text, boolean)', 'EXECUTE'),
  false, '(a) anon não executa a RPC');
SELECT is(has_function_privilege('authenticated', 'public.master_ticket_move(uuid, text, boolean)', 'EXECUTE'),
  true, '(a) authenticated executa (o gate é is_master_user dentro)');

-- ---------------------------------------------------------------------------
-- (b) Cliente: exatamente como antes
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5de1108-0001-0000-0000-000000001108","role":"authenticated"}', true);

SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000007', 'concluido') $$,
  '42501', NULL, '(b) cliente não chama a RPC');

-- A variável que a RPC liga não vale nada para quem não é master.
SELECT set_config('torque.support_staff_move', 'on', true);

SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'fechado'
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000007' $$,
  '23514', NULL, '(b) cliente com a variável ligada não fecha');
SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'resolvido'
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000007' $$,
  '23514', NULL, '(b) cliente com a variável ligada não resolve');
SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'em_andamento'
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000006' $$,
  '23514', NULL, '(b) cliente com a variável ligada não põe em andamento');
SELECT throws_ok($$ UPDATE public.support_tickets SET assigned_master_user_id = 'a5de1108-9999-0000-0000-000000001108'
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000007' $$,
  '23514', NULL, '(b) cliente não atribui');
SELECT throws_ok($$ UPDATE public.support_tickets SET closed_at = now()
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000007' $$,
  '23514', NULL, '(b) closed_at é relógio: o cliente não carimba');

SELECT lives_ok($$ UPDATE public.support_tickets SET status = 'aberto'
                    WHERE id = 'a5de1108-cccc-0000-0000-000000000006' $$,
  '(b) cliente reabre resolvido → aberto');

SELECT set_config('torque.support_staff_move', 'off', true);

SET LOCAL role postgres;
SELECT is((SELECT reopen_count FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000006'),
  1, '(b) a reabertura do cliente conta (OP-10)');
SELECT is((SELECT status::text FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000007'),
  'em_andamento', '(b) nada do que o cliente tentou passou');

-- ---------------------------------------------------------------------------
-- (c) Master FORA da RPC: as regras de antes
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5de1108-0003-0000-0000-000000001108","role":"authenticated"}', true);

SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'fechado'
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000009' $$,
  '23514', NULL, '(c) master não fecha por UPDATE direto');

-- ---------------------------------------------------------------------------
-- (d) Master pela RPC: livre
-- ---------------------------------------------------------------------------
SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000001', 'concluido') $$,
  '(d) aberto → Concluído');

SET LOCAL role postgres;
SELECT is((SELECT status::text FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000001'),
  'fechado', '(d) o chamado fica fechado');
SELECT ok((SELECT closed_at IS NOT NULL AND resolved_at IS NOT NULL
             FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000001'),
  '(d) fechar carimba closed_at e resolved_at');
SELECT is((SELECT count(*)::int FROM public.support_ticket_comments WHERE ticket_id = 'a5de1108-cccc-0000-0000-000000000001'),
  0, '(d) Concluído não envia nada ao cliente');
SELECT is(current_setting('torque.support_staff_move', true), 'off',
  '(d) a RPC desliga a variável depois do UPDATE');
SET LOCAL role authenticated;

SELECT throws_ok($$ UPDATE public.support_tickets SET status = 'em_andamento'
                     WHERE id = 'a5de1108-cccc-0000-0000-000000000001' $$,
  '23514', NULL, '(c) fechado continua terminal para UPDATE direto do master');

SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000001', 'andamento') $$,
  '(d) Concluído → Em andamento (reabre um fechado)');

SET LOCAL role postgres;
SELECT ok((SELECT status = 'em_andamento' AND closed_at IS NULL AND resolved_at IS NULL
             FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000001'),
  '(d) reabrir limpa closed_at e resolved_at');
SELECT is((SELECT assigned_master_user_id FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000001'),
  'a5de1108-9999-0000-0000-000000001108'::uuid, '(d) Em andamento sem dono: quem moveu assume');
SET LOCAL role authenticated;

SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000002', 'aberto') $$,
  '(d) Resolvido → Chamado aberto');

SET LOCAL role postgres;
SELECT ok((SELECT status = 'aberto' AND reopen_count = 0 AND resolved_at IS NULL
             FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000002'),
  '(d) mover NÃO conta reabertura e limpa resolved_at');
SET LOCAL role authenticated;

SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000008', 'andamento') $$,
  '(d) Diagnóstico feito → Em andamento');
SET LOCAL role postgres;
SELECT is((SELECT assigned_master_user_id FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000008'),
  'a5de1108-9998-0000-0000-000000001108'::uuid, '(d) dono existente não é sobrescrito');
SET LOCAL role authenticated;

-- ---------------------------------------------------------------------------
-- (e) Aguardando confirmação: com e sem resposta
-- ---------------------------------------------------------------------------
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000003', 'aguardando', true) $$,
  '23514', NULL, '(e) enviar resposta sem diagnóstico falha');

SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000004', 'aguardando', true) $$,
  '(e) enviar resposta com diagnóstico');

SET LOCAL role postgres;
SELECT ok((SELECT status = 'resolvido' AND resolved_at IS NOT NULL
             FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000004'),
  '(e) com resposta: Resolvido (o relógio de 7 dias começa)');
SELECT is((SELECT count(*)::int FROM public.support_ticket_comments
            WHERE ticket_id = 'a5de1108-cccc-0000-0000-000000000004'
              AND body = 'Corrigimos o problema.' AND NOT is_internal AND from_staff),
  1, '(e) a resposta pronta vira comentário público do suporte');
SET LOCAL role authenticated;

SELECT lives_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000005', 'aguardando', false) $$,
  '(e) só mudar o estado');

SET LOCAL role postgres;
SELECT is((SELECT status::text FROM public.support_tickets WHERE id = 'a5de1108-cccc-0000-0000-000000000005'),
  'resolvido', '(e) sem enviar: Resolvido');
SELECT is((SELECT count(*)::int FROM public.support_ticket_comments WHERE ticket_id = 'a5de1108-cccc-0000-0000-000000000005'),
  0, '(e) sem enviar: nenhum comentário');
SET LOCAL role authenticated;

-- ---------------------------------------------------------------------------
-- (f) Entradas inválidas
-- ---------------------------------------------------------------------------
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000005', 'aguardando') $$,
  '23514', NULL, '(f) mesma coluna não é movimento');
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000005', 'lixo') $$,
  '22023', NULL, '(f) coluna desconhecida');
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000005', 'concluido', true) $$,
  '22023', NULL, '(f) só Aguardando envia resposta');
SELECT throws_ok($$ SELECT public.master_ticket_move('a5de1108-cccc-0000-0000-000000000009', 'diagnostico') $$,
  '23514', NULL, '(f) Chamado aberto → Diagnóstico feito não é um fato que o UPDATE crie');

-- ---------------------------------------------------------------------------
-- (g) Auditoria
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SELECT is((SELECT count(*)::int FROM public.master_audit_logs
            WHERE action = 'SUPPORT_TICKET_MOVE'
              AND target_id::text LIKE 'a5de1108-cccc-%'),
  6, '(g) cada movimento aceito vai para master_audit_logs (e só os aceitos)');
SELECT is((SELECT details FROM public.master_audit_logs
            WHERE action = 'SUPPORT_TICKET_MOVE' AND target_id = 'a5de1108-cccc-0000-0000-000000000004'),
  '{"from_column":"andamento","to_column":"aguardando","from_status":"em_andamento","to_status":"resolvido","send_reply":true}'::jsonb,
  '(g) a auditoria diz de→para e se enviou resposta, sem PII');
SELECT is((SELECT master_user_id FROM public.master_audit_logs
            WHERE action = 'SUPPORT_TICKET_MOVE' AND target_id = 'a5de1108-cccc-0000-0000-000000000004'),
  'a5de1108-9999-0000-0000-000000001108'::uuid, '(g) a auditoria diz quem moveu');

SELECT * FROM finish();
ROLLBACK;
