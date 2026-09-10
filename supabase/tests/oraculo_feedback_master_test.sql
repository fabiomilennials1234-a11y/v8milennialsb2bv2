-- SCRUM-600 · feedback reproduzível, isolamento, sinais e entrega semanal.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_table('public', 'oraculo_tool_traces', '(STRUCT) rastro restrito existe');
SELECT has_table('public', 'oraculo_feedback', '(STRUCT) avaliações existem');
SELECT has_column('public', 'oraculo_feedback', 'rated_at', '(TEMPO) avaliação tem data de evento explícita');
SELECT has_table('public', 'oraculo_feedback_alerts', '(STRUCT) outbox de invenção existe');
SELECT has_table('public', 'oraculo_feedback_digest_deliveries', '(STRUCT) entrega semanal é idempotente');
SELECT has_table('public', 'oraculo_product_signals', '(STRUCT) sinais implícitos existem');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_tool_traces'::regclass), '(RLS) rastro tem RLS');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_tool_traces', 'SELECT'), '(SEGURANÇA) navegador não lê rastro bruto');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_feedback', 'SELECT'), '(SEGURANÇA) navegador não lê fotografia do rastro');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_feedback', 'INSERT'), '(SEGURANÇA) navegador não fabrica feedback');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_submit_feedback(uuid,uuid,text,text,text,text,uuid,uuid)', 'EXECUTE'), '(SEGURANÇA) ids explícitos ficam server-only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_feedback_case(uuid)', 'EXECUTE'), '(SEGURANÇA) caso completo fica server-only');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('06000000-0000-4000-8000-000000000001', 'Org Feedback Oráculo', 'org-feedback-oraculo-t');
INSERT INTO auth.users (id, email) VALUES
  ('06000000-0000-4000-8000-0000000000a1', 'pessoa-feedback@test.local'),
  ('06000000-0000-4000-8000-0000000000a2', 'vizinho-feedback@test.local');
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('06000000-0000-4000-8000-0000000000b1', '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1', 'Pessoa', 'member', true),
  ('06000000-0000-4000-8000-0000000000b2', '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a2', 'Vizinho', 'member', true);
INSERT INTO public.oraculo_conversations (id, organization_id, user_id, team_member_id, title) VALUES
  ('06000000-0000-4000-8000-0000000000c1', '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1', '06000000-0000-4000-8000-0000000000b1', 'Diagnóstico');
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE first_turn AS
SELECT public.oraculo_save_turn(
  '06000000-0000-4000-8000-0000000000c1',
  '06000000-0000-4000-8000-000000000001',
  '06000000-0000-4000-8000-0000000000a1',
  NULL, 'Como está a conversão?',
  '{"text":"Foram 12 vendas.","toolsUsed":["metricas"],"rejectedToolCalls":[],"hitToolCeiling":false,"telemetry":{"model":"test","inputTokens":1,"outputTokens":1,"latencyMs":1},"proposals":[{"kind":"oraculo_action_proposal","id":"06000000-0000-4000-8000-0000000000e1","acao":"adicionar_tag","criterio":{"tipo":"leads_sem_contato","dias":2},"parametros":{},"previsao":1,"status":"pendente"}],"profileQuestions":[]}'::jsonb,
  NULL,
  '[{"name":"metricas","result":{"vendas":12,"receita":40000}}]'::jsonb
) AS id;

SELECT is((SELECT count(*) FROM public.oraculo_tool_traces)::integer, 1, '(RASTRO) retorno completo nasce atômico com a resposta');
SELECT is((SELECT trace->0->'result'->>'receita' FROM public.oraculo_tool_traces), '40000', '(RASTRO) valor da ferramenta é reproduzível');

CREATE TEMP TABLE positive_feedback AS
SELECT public.oraculo_submit_feedback(
  '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1',
  'response', 'positive', NULL, NULL, (SELECT id FROM first_turn), NULL
) AS value;
SELECT is((SELECT jsonb_array_length(trace_snapshot) FROM public.oraculo_feedback WHERE id = ((SELECT value FROM positive_feedback)->>'id')::uuid), 1, '(FEEDBACK) avaliação fotografa o rastro do alvo');

SELECT throws_ok(
  format($q$SELECT public.oraculo_submit_feedback(
    '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a2',
    'response', 'negative', 'wrong_number', NULL, %L::uuid, NULL)$q$, (SELECT id FROM first_turn)),
  '42501', NULL, '(ISOLAMENTO) colega não avalia resposta alheia');

CREATE TEMP TABLE invented_feedback AS
SELECT public.oraculo_submit_feedback(
  '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1',
  'conversation', 'negative', 'invented', 'Inventou receita.', NULL,
  '06000000-0000-4000-8000-0000000000c1'
) AS value;
SELECT ok(((SELECT value FROM invented_feedback)->>'alert_id') IS NOT NULL, '(ALERTA) invenção cria outbox imediata');
SELECT is((public.oraculo_claim_feedback_alert(((SELECT value FROM invented_feedback)->>'alert_id')::uuid)->>'organization_name'), 'Org Feedback Oráculo', '(ALERTA) worker reabre payload operacional');
SELECT is(public.oraculo_claim_feedback_alert(((SELECT value FROM invented_feedback)->>'alert_id')::uuid), NULL, '(ALERTA) lease impede envio concorrente duplicado');
SELECT public.oraculo_finish_feedback_alert(((SELECT value FROM invented_feedback)->>'alert_id')::uuid, true, NULL);
SELECT is((SELECT status FROM public.oraculo_feedback_alerts), 'sent', '(ALERTA) entrega confirmada encerra retry');

SELECT public.oraculo_record_product_signal(
  '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1',
  'briefing_opened', NULL, NULL);
SELECT public.oraculo_record_product_signal(
  '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1',
  'briefing_opened', NULL, NULL);
SELECT public.oraculo_record_product_signal(
  '06000000-0000-4000-8000-000000000001', '06000000-0000-4000-8000-0000000000a1',
  'proposal_clicked', '06000000-0000-4000-8000-0000000000c1', '06000000-0000-4000-8000-0000000000e1');
SELECT is((SELECT count(*) FROM public.oraculo_product_signals WHERE event_type = 'briefing_opened')::integer, 1, '(SINAL) briefing aberto é idempotente no dia');
SELECT is((SELECT count(*) FROM public.oraculo_product_signals WHERE event_type = 'proposal_clicked')::integer, 1, '(SINAL) clique em proposta é instrumentado');

SELECT public.oraculo_save_turn(
  '06000000-0000-4000-8000-0000000000c1',
  '06000000-0000-4000-8000-000000000001',
  '06000000-0000-4000-8000-0000000000a1',
  (SELECT last_message_at FROM public.oraculo_conversations WHERE id = '06000000-0000-4000-8000-0000000000c1'),
  'E comparado ao mês anterior?',
  '{"text":"Cresceu.","toolsUsed":[],"rejectedToolCalls":[],"hitToolCeiling":false,"telemetry":{"model":"test","inputTokens":1,"outputTokens":1,"latencyMs":1},"proposals":[],"profileQuestions":[]}'::jsonb,
  NULL, '[]'::jsonb
);
SELECT is((SELECT count(*) FROM public.oraculo_product_signals WHERE event_type = 'conversation_continued')::integer, 1, '(SINAL) segundo turno registra continuação uma vez');

CREATE TEMP TABLE weekly AS
SELECT public.oraculo_prepare_weekly_feedback_digest(now()) AS value;
SELECT ok((SELECT value IS NOT NULL FROM weekly), '(SEMANAL) semana ganha entrega mesmo sem feedback no período fechado');
SELECT is(((SELECT value FROM weekly)->>'negative')::integer, 0, '(SEMANAL) resumo vazio traz zero explícito');
SELECT is(public.oraculo_prepare_weekly_feedback_digest(now()), NULL, '(SEMANAL) lease evita resumo duplicado');
SELECT public.oraculo_finish_weekly_feedback_digest(((SELECT value FROM weekly)->>'delivery_id')::uuid, true, NULL);
SELECT is((SELECT status FROM public.oraculo_feedback_digest_deliveries), 'sent', '(SEMANAL) entrega bem-sucedida fica registrada');

SELECT * FROM finish();
ROLLBACK;
