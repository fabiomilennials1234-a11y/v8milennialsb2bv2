-- SCRUM-599 · entrevista opcional, histórico, divergência e adoção.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_table('public', 'oraculo_interview_questions', '(STRUCT) perguntas persistidas existem');
SELECT has_table('public', 'oraculo_operation_profile_entries', '(STRUCT) histórico do perfil existe');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_interview_questions'::regclass), '(RLS) perguntas têm RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_operation_profile_entries'::regclass), '(RLS) respostas têm RLS');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_interview_questions', 'INSERT'), '(SEGURANÇA) navegador não fabrica perguntas');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_operation_profile_entries', 'INSERT'), '(SEGURANÇA) navegador não fabrica perfil ou autoria');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_adjust_member_profile(uuid,uuid,uuid,text,text)', 'EXECUTE'), '(SEGURANÇA) ajuste com ids explícitos é exclusivo do servidor');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('05990000-0000-4000-8000-000000000001', 'Org Perfil Oráculo', 'org-perfil-oraculo-t');
INSERT INTO auth.users (id, email) VALUES
  ('05990000-0000-4000-8000-0000000000a1', 'pessoa-perfil@test.local'),
  ('05990000-0000-4000-8000-0000000000a2', 'admin-perfil@test.local');
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('05990000-0000-4000-8000-0000000000b1', '05990000-0000-4000-8000-000000000001', '05990000-0000-4000-8000-0000000000a1', 'Ana', 'member', true),
  ('05990000-0000-4000-8000-0000000000b2', '05990000-0000-4000-8000-000000000001', '05990000-0000-4000-8000-0000000000a2', 'Gestora', 'admin', true);
INSERT INTO public.oraculo_conversations (id, organization_id, user_id, team_member_id, title) VALUES
  ('05990000-0000-4000-8000-0000000000c1', '05990000-0000-4000-8000-000000000001', '05990000-0000-4000-8000-0000000000a1', '05990000-0000-4000-8000-0000000000b1', 'Perfil');
SET LOCAL session_replication_role = origin;

SELECT public.oraculo_save_turn(
  '05990000-0000-4000-8000-0000000000c1', '05990000-0000-4000-8000-000000000001', '05990000-0000-4000-8000-0000000000a1', NULL, 'Como está a operação?',
  '{"text":"Medi o período.","toolsUsed":["metricas"],"rejectedToolCalls":[],"hitToolCeiling":false,"telemetry":{"model":"test","inputTokens":1,"outputTokens":1,"latencyMs":1},"proposals":[],"profileQuestions":[
    {"id":"05990000-0000-4000-8000-000000000101","question_key":"sales_outside_crm","prompt":"Medi 12 vendas. Existem vendas fora?","measured_context":{"source":"metricas","vendas":12}},
    {"id":"05990000-0000-4000-8000-000000000102","question_key":"meeting_definition","prompt":"Medi 22 reuniões. O que conta como reunião?","measured_context":{"source":"metricas","reunioes_marcadas":22}},
    {"id":"05990000-0000-4000-8000-000000000103","question_key":"seasonality","prompt":"Medi 80 leads. Este período é normal?","measured_context":{"source":"metricas","leads_criados":80}},
    {"id":"05990000-0000-4000-8000-000000000104","question_key":"perceived_bottleneck","prompt":"Medi 17 negócios na proposta. É o gargalo?","measured_context":{"source":"funil","negocios":17}},
    {"id":"05990000-0000-4000-8000-000000000105","question_key":"personal_practice","prompt":"Medi seu recorte. O que não aparece?","measured_context":{"source":"metricas"}}]}'::jsonb,
  NULL);

SELECT is((SELECT count(*) FROM public.oraculo_interview_questions WHERE conversation_id = '05990000-0000-4000-8000-0000000000c1')::integer, 3, '(LIMITE) cinco itens internos persistem no máximo três por sessão');
SELECT is((SELECT min(asked_user_id::text) FROM public.oraculo_interview_questions), '05990000-0000-4000-8000-0000000000a1', '(AUTORIA) pergunta pertence ao usuário');
SELECT is((SELECT measured_context->>'vendas' FROM public.oraculo_interview_questions WHERE question_key = 'sales_outside_crm'), '12', '(EVIDÊNCIA) medição fica auditável');

SELECT throws_ok($q$ SELECT public.oraculo_record_profile_response('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000a2','05990000-0000-4000-8000-0000000000b2','05990000-0000-4000-8000-000000000101','inventada',false) $q$, '42501', NULL, '(ISOLAMENTO) outra pessoa não responde pergunta alheia');
SELECT public.oraculo_record_profile_response('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000a1','05990000-0000-4000-8000-0000000000b1','05990000-0000-4000-8000-000000000101','Fechamos duas vendas fora do CRM.',false);
SELECT is((SELECT status FROM public.oraculo_interview_questions WHERE id = '05990000-0000-4000-8000-000000000101'), 'answered', '(RESPOSTA) pergunta deixa de ficar pendente');
SELECT is((SELECT author_role FROM public.oraculo_operation_profile_entries), 'member', '(AUTORIA) fala inicial fica identificada');

SELECT public.oraculo_edit_own_profile('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000a1','05990000-0000-4000-8000-0000000000b1','sales_outside_crm','Revendo: foram três vendas fora do CRM.');
SELECT is((SELECT count(*) FROM public.oraculo_operation_profile_entries)::integer, 2, '(HISTÓRICO) editar cria versão sem sobrescrever');
SELECT ok((SELECT previous_entry_id IS NOT NULL FROM public.oraculo_operation_profile_entries WHERE source = 'settings'), '(HISTÓRICO) versão aponta para anterior');

SELECT public.oraculo_adjust_member_profile('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000a2','05990000-0000-4000-8000-0000000000b1','sales_outside_crm','Foi uma venda fora do CRM.');
SELECT is((public.oraculo_get_operation_profile('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000b1')->0->>'member_answer'), 'Revendo: foram três vendas fora do CRM.', '(VOZ) ajuste não apaga descrição da pessoa');
SELECT is((public.oraculo_get_operation_profile('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000b1')->0->>'admin_answer'), 'Foi uma venda fora do CRM.', '(AJUSTE) versão administrativa aparece separada');
SELECT ok((public.oraculo_get_operation_profile('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000b1')->0->>'divergent')::boolean, '(DIVERGÊNCIA) diferença fica explícita');
SELECT alike(public.oraculo_get_profile_context('05990000-0000-4000-8000-000000000001','05990000-0000-4000-8000-0000000000b1'), '%divergência registrada%', '(CONTEXTO) respostas compõem análises seguintes');
SELECT ok((SELECT responded_last_60d FROM public.oraculo_profile_adoption_60d WHERE organization_id = '05990000-0000-4000-8000-000000000001'), '(ADOÇÃO) organização respondente é medida em 60 dias');

SELECT * FROM finish();
ROLLBACK;
