-- supabase/tests/oraculo_onda1_test.sql
--
-- Oráculo · Onda 1 — SCRUM-593 (autoria) e SCRUM-594 (espinha).
-- ADR-0032 (o Oráculo propõe, o humano escreve) e ADR-0033 (o praticado).
--
-- O que estas asserções guardam, em ordem de gravidade:
--
--   1. A ferramenta `metricas` recebe a organização POR PARÂMETRO. Isso só é
--      seguro enquanto `authenticated` não puder executá-la — quem resolve o
--      Escopo é a edge function, a partir do JWT. Esta base já teve que fechar
--      14 funções DEFINER com org por parâmetro; a asserção existe para que a
--      15ª não nasça aqui.
--   2. A conversa do Oráculo é pessoal: `admin` não lê a de `member` e
--      vice-versa. Testado COMO role `authenticated` — `postgres` bypassa RLS
--      e produziria verde falso.
--   3. Os turnos não são escrevíveis pelo usuário. Se fossem, a procedência
--      exibida na tela seria ficção.
--   4. Receita sai do caderno `sale_events`, líquida de estorno (ADR-0017).
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/oraculo_onda1_test.sql
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) autoria da mensagem — SCRUM-593
-- ===========================================================================
SELECT has_column('public', 'whatsapp_messages', 'sent_by_team_member_id',
  '(STRUCT) whatsapp_messages.sent_by_team_member_id existe');

SELECT col_is_null('public', 'whatsapp_messages', 'sent_by_team_member_id',
  '(STRUCT) autoria é ANULÁVEL — robô, Master e Gestor não têm Team Member autor');

SELECT has_column('public', 'channel_messages', 'sent_by_team_member_id',
  '(STRUCT) o canal oficial também grava autoria');

-- ===========================================================================
-- (STRUCT) conversa com memória — SCRUM-594
-- ===========================================================================
SELECT has_table('public', 'oraculo_conversations', '(STRUCT) oraculo_conversations existe');
SELECT has_table('public', 'oraculo_turns',         '(STRUCT) oraculo_turns existe');
SELECT has_column('public', 'oraculo_conversations', 'summary',
  '(STRUCT) o resumo acumulado tem onde morar — sem ele a memória é só janela');
SELECT has_column('public', 'oraculo_turns', 'tools_used',
  '(STRUCT) a procedência é persistida, não recalculada na tela');
SELECT has_column('public', 'oraculo_turns', 'rejected_tools',
  '(STRUCT) ferramenta recusada fica registrada — detector sem consumidor reproduz o incidente');
SELECT has_column('public', 'organizations', 'oraculo_daily_turn_limit',
  '(STRUCT) o teto diário é ajustável por organização, sem deploy');

-- ===========================================================================
-- (SEGURANÇA) o vetor cross-tenant que a org-por-parâmetro abriria
-- ===========================================================================
SELECT has_function('public', 'oraculo_metricas', ARRAY['uuid','uuid','integer'],
  '(STRUCT) a ferramenta metricas existe');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.oraculo_metricas(uuid,uuid,integer)', 'EXECUTE'),
  '(SEGURANÇA) authenticated NÃO executa oraculo_metricas — a org vem por parâmetro');

SELECT ok(
  NOT has_function_privilege('anon', 'public.oraculo_metricas(uuid,uuid,integer)', 'EXECUTE'),
  '(SEGURANÇA) anon NÃO executa oraculo_metricas');

SELECT ok(
  has_function_privilege('service_role', 'public.oraculo_metricas(uuid,uuid,integer)', 'EXECUTE'),
  '(SEGURANÇA) service_role executa — é a edge function que resolveu o Escopo');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.oraculo_turns', 'INSERT'),
  '(SEGURANÇA) o usuário não escreve turno — senão a procedência da tela é ficção');

-- `anon` recebe SELECT por DEFAULT PRIVILEGES em toda tabela nova de `public`.
-- Esta base já teve uma tabela de backup legível por anônimo exatamente assim.
SELECT ok(
  NOT has_table_privilege('anon', 'public.oraculo_turns', 'SELECT'),
  '(SEGURANÇA) anônimo não lê turno do Oráculo');

SELECT ok(
  NOT has_table_privilege('anon', 'public.oraculo_conversations', 'SELECT'),
  '(SEGURANÇA) anônimo não lê conversa do Oráculo');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.oraculo_conversations', 'UPDATE'),
  '(SEGURANÇA) o usuário não reescreve a própria conversa');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_conversations'::regclass),
  '(SEGURANÇA) RLS ligada em oraculo_conversations');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_turns'::regclass),
  '(SEGURANÇA) RLS ligada em oraculo_turns');

-- ===========================================================================
-- (PERMISSÃO) view_org_metrics — ADR-0032 §5
-- ===========================================================================
SELECT is(
  (SELECT default_value FROM public.feature_permissions WHERE key = 'metrics.view_org'),
  false,
  '(PERMISSÃO) metrics.view_org nasce NEGADA — o member não alcança a organização');

SELECT is(
  (SELECT is_admin_only FROM public.feature_permissions WHERE key = 'metrics.view_org'),
  false,
  '(PERMISSÃO) metrics.view_org NÃO é admin_only — senão a exceção por organização não existiria');

-- ===========================================================================
-- Fixture
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('0aca0000-0000-4000-8000-000000000001', 'Org Oráculo', 'org-oraculo-t', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('0aca0000-0000-4000-8000-0000000000a1', 'gestor-oraculo@test.local'),
  ('0aca0000-0000-4000-8000-0000000000a2', 'vendedora-oraculo@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('0aca0000-0000-4000-8000-0000000000b1', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000a1', 'Gestor', 'admin', true),
  ('0aca0000-0000-4000-8000-0000000000b2', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000a2', 'Ana', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- Duas conversas: uma de cada pessoa.
INSERT INTO public.oraculo_conversations (id, organization_id, user_id, team_member_id, title) VALUES
  ('0aca0000-0000-4000-8000-0000000000c1', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000a1', '0aca0000-0000-4000-8000-0000000000b1', 'Conversa do gestor'),
  ('0aca0000-0000-4000-8000-0000000000c2', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000a2', '0aca0000-0000-4000-8000-0000000000b2', 'Conversa da Ana');

INSERT INTO public.oraculo_turns (conversation_id, organization_id, user_id, role, content) VALUES
  ('0aca0000-0000-4000-8000-0000000000c1', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000a1', 'user', 'onde estou perdendo?'),
  ('0aca0000-0000-4000-8000-0000000000c2', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000a2', 'user', 'como está meu funil?');

-- ===========================================================================
-- (RLS) como role authenticated — postgres bypassa RLS e daria verde falso
-- ===========================================================================
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0aca0000-0000-4000-8000-0000000000a2","role":"authenticated"}';

SELECT is(
  (SELECT count(*) FROM public.oraculo_conversations
    WHERE organization_id = '0aca0000-0000-4000-8000-000000000001')::int,
  1,
  '(RLS) a vendedora enxerga UMA conversa: a dela');

SELECT is(
  (SELECT count(*) FROM public.oraculo_conversations
    WHERE id = '0aca0000-0000-4000-8000-0000000000c1')::int,
  0,
  '(RLS) a conversa do gestor é inalcançável para a vendedora');

SELECT is(
  (SELECT count(*) FROM public.oraculo_turns
    WHERE conversation_id = '0aca0000-0000-4000-8000-0000000000c1')::int,
  0,
  '(RLS) os turnos do gestor também não vazam');

SELECT throws_ok(
  $q$ SELECT public.oraculo_metricas('0aca0000-0000-4000-8000-000000000001'::uuid, NULL, 30) $q$,
  '42501',
  NULL,
  '(SEGURANÇA) authenticated chamando a ferramenta é recusado pelo banco');

RESET role;

-- ===========================================================================
-- (COMPORTAMENTO) a ferramenta mede, e o Escopo recorta
-- ===========================================================================
SET LOCAL role postgres;

INSERT INTO public.leads (id, organization_id, name, responsible_id, created_at) VALUES
  ('0aca0000-0000-4000-8000-0000000000d1', '0aca0000-0000-4000-8000-000000000001', 'Lead da Ana',
   '0aca0000-0000-4000-8000-0000000000b2', now() - interval '2 days'),
  ('0aca0000-0000-4000-8000-0000000000d2', '0aca0000-0000-4000-8000-000000000001', 'Lead do gestor',
   '0aca0000-0000-4000-8000-0000000000b1', now() - interval '2 days');

SELECT is(
  (public.oraculo_metricas('0aca0000-0000-4000-8000-000000000001'::uuid, NULL, 30) ->> 'leads_criados')::int,
  2,
  '(COMPORTAMENTO) Escopo de organização soma os dois leads');

SELECT is(
  (public.oraculo_metricas('0aca0000-0000-4000-8000-000000000001'::uuid,
     '0aca0000-0000-4000-8000-0000000000b2'::uuid, 30) ->> 'leads_criados')::int,
  1,
  '(COMPORTAMENTO) Escopo de pessoa só conta o que ela atende');

-- Receita líquida: uma venda vale, a outra foi estornada.
-- `producer='carteira'` dispensa pipeline/stage; `origin_record_id` é
-- obrigatório fora do funil. Os CHECKs do caderno são parte do contrato.
INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, sold_at, sale_value,
                                sale_responsible_id, source, producer, origin_record_id,
                                currency, revenue_stream)
VALUES
  ('0aca0000-0000-4000-8000-0000000000e1', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000d1', 'sale', now() - interval '1 day', 1000,
   '0aca0000-0000-4000-8000-0000000000b2', 'backfill', 'carteira',
   '0aca0000-0000-4000-8000-0000000000d1', 'BRL', 'carteira'),
  ('0aca0000-0000-4000-8000-0000000000e2', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000d2', 'sale', now() - interval '1 day', 5000,
   '0aca0000-0000-4000-8000-0000000000b1', 'backfill', 'carteira',
   '0aca0000-0000-4000-8000-0000000000d2', 'BRL', 'carteira');

INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, sold_at, sale_value,
                                reversed_event_id, source, producer, origin_record_id,
                                currency, revenue_stream)
VALUES
  ('0aca0000-0000-4000-8000-0000000000e3', '0aca0000-0000-4000-8000-000000000001',
   '0aca0000-0000-4000-8000-0000000000d2', 'sale_reversed', now(), 5000,
   '0aca0000-0000-4000-8000-0000000000e2', 'backfill', 'carteira',
   '0aca0000-0000-4000-8000-0000000000d2', 'BRL', 'carteira');

SELECT is(
  (public.oraculo_metricas('0aca0000-0000-4000-8000-000000000001'::uuid, NULL, 30) ->> 'receita')::numeric,
  1000::numeric,
  '(ADR-0017) receita é líquida de estorno — a venda revertida não conta');

SELECT is(
  (public.oraculo_metricas('0aca0000-0000-4000-8000-000000000001'::uuid, NULL, 30) ->> 'vendas')::int,
  1,
  '(ADR-0017) a contagem de vendas também desconta o estorno');

SELECT * FROM finish();
ROLLBACK;
