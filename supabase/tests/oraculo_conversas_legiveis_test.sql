BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_function('public', 'oraculo_conversas', ARRAY['uuid','uuid','integer','integer']);
SELECT has_function('public', 'oraculo_conversa_detalhe', ARRAY['uuid','uuid','uuid','uuid','integer']);
SELECT has_column('public', 'conversation_summaries', 'source_last_message_at',
  '(FRESCOR) resumo guarda watermark da última mensagem incorporada');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.oraculo_conversa_detalhe(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  '(SEGURANÇA) cliente não escolhe org/responsável ao chamar detalhe');
SELECT ok(has_function_privilege('service_role',
  'public.oraculo_conversa_detalhe(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  '(CONTRATO) edge service_role executa detalhe');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('0acb0000-0000-4000-8000-000000000001', 'Org Conversas', 'org-conversas-t');
INSERT INTO auth.users (id, email) VALUES
  ('0acb0000-0000-4000-8000-0000000000a1', 'dona-conversa@test.local'),
  ('0acb0000-0000-4000-8000-0000000000a2', 'colega-conversa@test.local');
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('0acb0000-0000-4000-8000-0000000000b1', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000a1', 'Dona', 'member', true),
  ('0acb0000-0000-4000-8000-0000000000b2', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000a2', 'Colega', 'member', true);
INSERT INTO public.leads (id, organization_id, name, sale_responsible_id, normalized_phone) VALUES
  ('0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-000000000001',
   'Lead confidencial', '0acb0000-0000-4000-8000-0000000000b1', '5511999999999');
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider, instance_id) VALUES
  ('0acb0000-0000-4000-8000-0000000000d1', '0acb0000-0000-4000-8000-000000000001',
   'Caixa dona', 'uazapi', 'oraculo-box-test');
INSERT INTO public.whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id) VALUES
  ('0acb0000-0000-4000-8000-0000000000d1', '0acb0000-0000-4000-8000-0000000000b1');
INSERT INTO public.whatsapp_conversation_summary
  (organization_id, instance_id, normalized_phone, phone_number, last_message, last_message_time,
   last_message_direction, lead_id, is_group)
VALUES
  ('0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000d1',
   '5511999999999', '5511999999999', 'Preço reservado', now() - interval '90 minutes',
   'incoming', '0acb0000-0000-4000-8000-0000000000c1', false);
INSERT INTO public.whatsapp_messages
  (organization_id, instance_id, message_id, remote_jid, phone_number, normalized_phone,
   direction, content, lead_id, "timestamp")
VALUES
  ('0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000d1',
   'oraculo-msg-1', '5511999999999@s.whatsapp.net', '5511999999999', '5511999999999',
   'incoming', 'Preço reservado: R$ 713.250', '0acb0000-0000-4000-8000-0000000000c1', now() - interval '2 hours');
INSERT INTO public.conversation_summaries
  (organization_id, lead_id, instance_id, summary, sentiment, lead_temperature, objections,
   message_count, source_last_message_at)
VALUES
  ('0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000c1',
   '0acb0000-0000-4000-8000-0000000000d1', 'Negociação reservada', 'positive', 'hot',
   '["Preço"]'::jsonb, 1, now() - interval '2 hours');

SET LOCAL session_replication_role = origin;

SELECT is(
  jsonb_array_length(public.oraculo_conversa_detalhe(
    '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000b1',
    '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1', 100)),
  1, '(ESCOPO) responsável lê sua transcrição');
SELECT is(
  public.oraculo_conversa_detalhe(
    '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000b2',
    '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1', 100),
  '[]'::jsonb, '(ESCOPO) colega recebe vazio, sem erro genérico');
SELECT is(
  (public.oraculo_conversas('0acb0000-0000-4000-8000-000000000001',
    '0acb0000-0000-4000-8000-0000000000b1', 30, 20)->>'conversas')::int,
  1, '(AGREGADO) responsável conta sua conversa');
SELECT is(
  (public.oraculo_conversas('0acb0000-0000-4000-8000-000000000001',
    '0acb0000-0000-4000-8000-0000000000b2', 30, 20)->>'conversas')::int,
  0, '(AGREGADO) colega não conta conversa alheia');

SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a2","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM public.conversation_summaries), 0,
  '(RLS) colega não lê resumo direto, fora do Oráculo');
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM public.conversation_summaries), 1,
  '(RLS) responsável autorizado lê resumo direto');
RESET role;
SET LOCAL role postgres;

-- Novo evento posterior ao resumo entra na fila; o claim é atômico e limitado.
SELECT is((SELECT count(*)::int FROM public.claim_conversation_summary_jobs(9999)), 1,
  '(CRON) conversa desatualizada é reivindicada com teto interno');
SELECT is((SELECT status FROM public.conversation_summary_jobs LIMIT 1), 'processing',
  '(CRON) claim deixa lease explícito');

SELECT * FROM finish();
ROLLBACK;
