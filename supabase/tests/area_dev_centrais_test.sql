-- supabase/tests/area_dev_centrais_test.sql
--
-- Guarda das regras da Área Dev (board "18 telas → 5 centrais") que moram no
-- BANCO, não na tela:
--   20271105000000  OP-9  enviar a resposta e marcar Resolvido, juntos
--   20271105000100  IM-1…IM-4  implantação: entrada automática e gates
--   20271105000200  OR-6/7  sinais de saúde só para master
--   20271105000300  TE-5  resumo das avaliações só para master
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/area_dev_centrais_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures
--   ORG       cliente em implantação (criada com os triggers LIGADOS: IM-1)
--   SANDBOX   cópia de teste — não entra no quadro
--   U_MEMBRO  membro da ORG
--   U_MASTER  master pleno
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
  ('a5de1105-0001-0000-0000-000000001105'::uuid, 'membro-1105@test.local'),
  ('a5de1105-0003-0000-0000-000000001105'::uuid, 'master-1105@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (id, user_id, is_active, permissions)
VALUES ('a5de1105-9999-0000-0000-000000001105', 'a5de1105-0003-0000-0000-000000001105', true, '{"all": true}')
ON CONFLICT (user_id) DO UPDATE SET is_active = true, permissions = '{"all": true}';

-- IM-1: org criada com triggers ligados.
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('a5de1105-aaaa-0000-0000-000000001105', 'Org Implantação', 'org-impl-1105', 'America/Sao_Paulo');
INSERT INTO public.organizations (id, name, slug, timezone, is_sandbox)
VALUES ('a5de1105-bbbb-0000-0000-000000001105', 'Org Sandbox', 'org-sandbox-1105', 'America/Sao_Paulo', true);

SET LOCAL session_replication_role = replica;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES ('a5de1105-1111-0000-0000-000000001105', 'a5de1105-aaaa-0000-0000-000000001105',
        'a5de1105-0001-0000-0000-000000001105', 'Membro', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.support_tickets (id, organization_id, author_user_id, title, description, tipo, impacto, status)
VALUES
  ('a5de1105-cccc-0000-0000-000000000001', 'a5de1105-aaaa-0000-0000-000000001105',
   'a5de1105-0001-0000-0000-000000001105', 'Chamado sem resposta pronta', 'x', 'bug', 'contorno', 'em_andamento'),
  ('a5de1105-cccc-0000-0000-000000000002', 'a5de1105-aaaa-0000-0000-000000001105',
   'a5de1105-0001-0000-0000-000000001105', 'Chamado com resposta pronta', 'x', 'bug', 'contorno', 'em_andamento'),
  ('a5de1105-cccc-0000-0000-000000000003', 'a5de1105-aaaa-0000-0000-000000001105',
   'a5de1105-0001-0000-0000-000000001105', 'Chamado ainda aberto', 'x', 'bug', 'contorno', 'aberto');

INSERT INTO public.support_ticket_diagnoses (
  ticket_id, kind, complexity, summary, customer_reply, recommended_model,
  recommended_effort, resolution_prompt, keystones
)
SELECT t.id, 'fix', 'baixa', 'Diagnóstico de teste com dez+', t.reply, 'sonnet', 'medium',
       repeat('prompt de resolução ', 5), '[{"label":"ok","verify":"select 1"}]'
FROM (VALUES
  ('a5de1105-cccc-0000-0000-000000000001'::uuid, NULL),
  ('a5de1105-cccc-0000-0000-000000000002'::uuid, 'Corrigimos o problema.'),
  ('a5de1105-cccc-0000-0000-000000000003'::uuid, 'Corrigimos o problema.')
) AS t(id, reply);

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) IM-1 e estrutura
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT stage FROM public.org_implementations WHERE organization_id = 'a5de1105-aaaa-0000-0000-000000001105'),
  'cliente_novo', '(a) IM-1: org nova entra como Cliente novo');

SELECT is(
  (SELECT count(*)::int FROM public.org_implementations WHERE organization_id = 'a5de1105-bbbb-0000-0000-000000001105'),
  0, '(a) sandbox não entra no quadro');

SELECT is(
  has_table_privilege('authenticated', 'public.org_implementations', 'UPDATE'),
  false, '(a) a tabela não aceita escrita direta: o gate mora na RPC');

-- ---------------------------------------------------------------------------
-- (b) Não-master não lê nem mexe
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5de1105-0001-0000-0000-000000001105","role":"authenticated"}', true);

SELECT throws_ok($$ SELECT * FROM public.master_list_implementations() $$, '42501', NULL,
  '(b) membro não lista implantações');
SELECT throws_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'construcao') $$,
  '42501', NULL, '(b) membro não avança etapa');
SELECT throws_ok($$ SELECT * FROM public.master_org_health_signals() $$, '42501', NULL,
  '(b) membro não lê os sinais de saúde da frota');
SELECT throws_ok($$ SELECT * FROM public.master_copilot_eval_summary(30) $$, '42501', NULL,
  '(b) membro não lê o resumo das avaliações');
SELECT throws_ok($$ SELECT public.master_ticket_send_reply('a5de1105-cccc-0000-0000-000000000002') $$,
  '42501', NULL, '(b) membro não envia resposta de suporte');

-- ---------------------------------------------------------------------------
-- (c) IM-2…IM-4: os gates
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"a5de1105-0003-0000-0000-000000001105","role":"authenticated"}', true);

SELECT ok(
  EXISTS (SELECT 1 FROM public.master_list_implementations()
           WHERE organization_id = 'a5de1105-aaaa-0000-0000-000000001105'),
  '(c) master lista a implantação');

SELECT throws_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'construcao') $$,
  '23514', NULL, '(c) IM-2: sem plano e sem responsável não sai de Cliente novo');

SELECT lives_ok($$ SELECT public.master_update_implementation(
  'a5de1105-aaaa-0000-0000-000000001105', 'a5de1105-9999-0000-0000-000000001105', NULL, NULL) $$,
  '(c) master define o responsável');

SELECT throws_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'construcao') $$,
  '23514', NULL, '(c) IM-2: só responsável, sem plano, ainda trava');

SET LOCAL role postgres;
UPDATE public.organizations SET subscription_plan = 'pro' WHERE id = 'a5de1105-aaaa-0000-0000-000000001105';
SET LOCAL role authenticated;

SELECT lives_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'construcao') $$,
  '(c) IM-2: com plano e responsável, vai para Construção');

SELECT throws_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'concluido') $$,
  '23514', NULL, '(c) não pula etapa');

SELECT throws_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'call') $$,
  '23514', NULL, '(c) IM-3: sem WhatsApp conectado e funis com ganho e perda, não vai para a Call');

SELECT lives_ok($$ SELECT public.master_advance_implementation('a5de1105-aaaa-0000-0000-000000001105', 'cliente_novo') $$,
  '(c) voltar uma etapa é permitido');

SET LOCAL role postgres;
SELECT is(
  (SELECT count(*)::int FROM public.master_audit_logs
    WHERE action = 'IMPLEMENTATION_STAGE' AND target_id = 'a5de1105-aaaa-0000-0000-000000001105'),
  2, '(c) PE-3: cada mudança de etapa vai para a auditoria');
SET LOCAL role authenticated;

-- ---------------------------------------------------------------------------
-- (d) OP-9: resposta e Resolvido, juntos
-- ---------------------------------------------------------------------------
SELECT throws_ok($$ SELECT public.master_ticket_send_reply('a5de1105-cccc-0000-0000-000000000001') $$,
  '23514', NULL, '(d) sem resposta pronta, o envio é bloqueado');

SELECT throws_ok($$ SELECT public.master_ticket_send_reply('a5de1105-cccc-0000-0000-000000000003') $$,
  '23514', NULL, '(d) chamado que ninguém pegou não recebe a resposta');

SELECT lives_ok($$ SELECT public.master_ticket_send_reply('a5de1105-cccc-0000-0000-000000000002') $$,
  '(d) em andamento com resposta pronta: envia');

SELECT is(
  (SELECT status::text FROM public.support_tickets WHERE id = 'a5de1105-cccc-0000-0000-000000000002'),
  'resolvido', '(d) o chamado fica Resolvido (o relógio de 7 dias começa)');

SELECT is(
  (SELECT count(*)::int FROM public.support_ticket_comments
    WHERE ticket_id = 'a5de1105-cccc-0000-0000-000000000002'
      AND body = 'Corrigimos o problema.' AND NOT is_internal AND from_staff),
  1, '(d) a resposta pronta vira comentário público do suporte');

SELECT throws_ok($$ SELECT public.master_ticket_send_reply('a5de1105-cccc-0000-0000-000000000002') $$,
  '23514', NULL, '(d) enviar de novo não duplica a resposta');

SELECT * FROM finish();
ROLLBACK;
