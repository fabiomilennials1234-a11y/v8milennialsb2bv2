-- supabase/tests/support_ticket_diagnoses_test.sql
--
-- Guarda de 20271102000000_chamado_diagnostico_e_prompt.sql e
-- 20271103000000_chamado_diagnostico_precisao.sql.
--
-- O diagnóstico de um Chamado carrega root cause, caminhos de arquivo e o
-- prompt de resolução — detalhe interno do sistema. O cliente LÊ a linha do
-- Chamado (autor e admin da org); este teste prova que ele NÃO lê, nem escreve,
-- o diagnóstico. E que os CHECKs recusam o registro malformado que o
-- torque-mcp poderia gravar.
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/support_ticket_diagnoses_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures
--   ORG       org do cliente
--   U_AUTOR   membro da ORG, autor do Chamado
--   U_ADMIN   admin da ORG (lê todos os Chamados da org)
--   U_MASTER  master, sem vínculo com a ORG
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('5d1a1102-aaaa-0000-0000-000000001102', 'Org Chamado', 'org-chamado-1102', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

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
  ('5d1a1102-0001-0000-0000-000000001102'::uuid, 'autor-1102@test.local'),
  ('5d1a1102-0002-0000-0000-000000001102'::uuid, 'admin-1102@test.local'),
  ('5d1a1102-0003-0000-0000-000000001102'::uuid, 'master-1102@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('5d1a1102-1111-0000-0000-000000001102', '5d1a1102-aaaa-0000-0000-000000001102',
   '5d1a1102-0001-0000-0000-000000001102', 'Autor', 'member', true),
  ('5d1a1102-2222-0000-0000-000000001102', '5d1a1102-aaaa-0000-0000-000000001102',
   '5d1a1102-0002-0000-0000-000000001102', 'Admin', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('5d1a1102-0003-0000-0000-000000001102', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.support_tickets (id, organization_id, author_user_id, title, description, tipo, impacto)
VALUES ('5d1a1102-cccc-0000-0000-000000001102', '5d1a1102-aaaa-0000-0000-000000001102',
        '5d1a1102-0001-0000-0000-000000001102', 'Kanban não move o card',
        'Arrasto e volta pra etapa anterior', 'bug', 'parado');

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.support_ticket_diagnoses'::regclass),
  true, '(a) RLS ligada');

SELECT is(
  has_table_privilege('anon', 'public.support_ticket_diagnoses', 'SELECT'),
  false, '(a) anon não tem nem o GRANT de SELECT');

-- ---------------------------------------------------------------------------
-- (b) Master grava e lê
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5d1a1102-0003-0000-0000-000000001102","role":"authenticated"}', true);

SELECT lives_ok($$
  INSERT INTO public.support_ticket_diagnoses (
    ticket_id, kind, complexity, summary, root_cause, recommended_model,
    recommended_effort, resolution_prompt, keystones, source
  ) VALUES (
    '5d1a1102-cccc-0000-0000-000000001102', 'fix', 'baixa',
    'Mover etapa em funil personalizado manda stage_key sem stage_id.',
    'UPDATE OF stage_key não dispara o evento quando só stage_id muda.',
    'sonnet', 'medium', repeat('prompt de resolução ', 5),
    '[{"label":"teste do hook passa","verify":"npx vitest run useMoveCard"}]', 'claude_code'
  )
$$, '(b) master insere o diagnóstico');

SELECT is(
  (SELECT count(*)::int FROM public.support_ticket_diagnoses),
  1, '(b) master lê o diagnóstico');

SELECT is(
  (SELECT diagnosed_by FROM public.support_ticket_diagnoses),
  '5d1a1102-0003-0000-0000-000000001102'::uuid, '(b) diagnosed_by assume auth.uid()');

-- ---------------------------------------------------------------------------
-- (c) Autor do Chamado: lê o Chamado, NÃO lê nem escreve o diagnóstico
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5d1a1102-0001-0000-0000-000000001102","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.support_tickets WHERE id = '5d1a1102-cccc-0000-0000-000000001102'),
  1, '(c) sanidade: o autor lê o próprio Chamado');

SELECT is(
  (SELECT count(*)::int FROM public.support_ticket_diagnoses),
  0, '(c) o autor NÃO lê o diagnóstico');

SELECT throws_ok($$
  INSERT INTO public.support_ticket_diagnoses (
    ticket_id, kind, complexity, summary, recommended_model, recommended_effort,
    resolution_prompt, keystones
  ) VALUES (
    '5d1a1102-cccc-0000-0000-000000001102', 'fix', 'baixa', 'tentativa do cliente',
    'opus', 'max', repeat('x', 60), '[{"label":"x"}]'
  )
$$, '42501', NULL, '(c) o autor NÃO grava diagnóstico');

UPDATE public.support_ticket_diagnoses SET summary = 'adulterado pelo cliente';

-- ---------------------------------------------------------------------------
-- (d) Admin da org: lê os Chamados da org, NÃO lê o diagnóstico
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5d1a1102-0002-0000-0000-000000001102","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.support_ticket_diagnoses),
  0, '(d) o admin da org NÃO lê o diagnóstico');

-- ---------------------------------------------------------------------------
-- (e) O UPDATE do cliente em (c) não pegou; os CHECKs recusam lixo
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5d1a1102-0003-0000-0000-000000001102","role":"authenticated"}', true);

SELECT is(
  (SELECT summary FROM public.support_ticket_diagnoses),
  'Mover etapa em funil personalizado manda stage_key sem stage_id.',
  '(e) o UPDATE do cliente não alterou nada');

SELECT throws_ok($$
  UPDATE public.support_ticket_diagnoses SET keystones = '[]'::jsonb
$$, '23514', NULL, '(e) keystones vazio é recusado — sem critério de pronto não há task');

SELECT throws_ok($$
  UPDATE public.support_ticket_diagnoses SET recommended_model = 'gpt-4.1-mini'
$$, '23514', NULL, '(e) modelo fora do catálogo é recusado');

SELECT throws_ok($$
  UPDATE public.support_ticket_diagnoses SET execution_outcome = 'resolvido'
$$, '23514', NULL, '(e) desfecho sem executed_at é recusado');

SELECT lives_ok($$
  UPDATE public.support_ticket_diagnoses
     SET executed_at = now(), execution_outcome = 'resolvido', actual_cost_usd = 1.37
$$, '(e) desfecho coerente é aceito');

-- ---------------------------------------------------------------------------
-- (f) Precisão do diagnóstico: domínios e só com execução registrada
-- ---------------------------------------------------------------------------
SELECT throws_ok($$
  UPDATE public.support_ticket_diagnoses SET root_cause_confirmed = 'talvez'
$$, '23514', NULL, '(f) confirmação fora do domínio é recusada');

SELECT throws_ok($$
  UPDATE public.support_ticket_diagnoses SET extra_commits = -1
$$, '23514', NULL, '(f) commits extras negativos são recusados');

SELECT lives_ok($$
  UPDATE public.support_ticket_diagnoses
     SET root_cause_confirmed = 'sim', extra_commits = 1, reply_contradicted = true
$$, '(f) precisão coerente com a execução é aceita');

SELECT throws_ok($$
  UPDATE public.support_ticket_diagnoses
     SET executed_at = NULL, execution_outcome = NULL, actual_cost_usd = NULL
$$, '23514', NULL, '(f) desfazer a execução sem limpar a precisão é recusado');

SELECT * FROM finish();

ROLLBACK;
