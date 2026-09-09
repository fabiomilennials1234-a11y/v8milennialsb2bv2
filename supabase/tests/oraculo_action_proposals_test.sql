-- SCRUM-598 · proposta pura, clique humano, permissão atual e critério atual.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_table('public', 'oraculo_action_proposals', '(STRUCT) proposta persistida existe');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_action_proposals'::regclass),
  '(RLS) propostas têm RLS');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_action_proposals', 'INSERT'),
  '(SEGURANÇA) navegador não fabrica proposta');
SELECT ok(NOT has_table_privilege('authenticated', 'public.oraculo_action_proposals', 'UPDATE'),
  '(SEGURANÇA) navegador não marca proposta como executada');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.oraculo_preview_action_proposal(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE'),
  '(SEGURANÇA) preview com org por parâmetro é exclusivo do servidor');
SELECT ok(has_function_privilege('authenticated',
  'public.execute_oraculo_action_proposal(uuid,uuid)', 'EXECUTE'),
  '(CONTRATO) usuário autenticado alcança somente a execução protegida');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('0acb0000-0000-4000-8000-000000000001', 'Org Ação Oráculo', 'org-acao-oraculo-t');
INSERT INTO auth.users (id, email) VALUES
  ('0acb0000-0000-4000-8000-0000000000a1', 'ator-oraculo@test.local'),
  ('0acb0000-0000-4000-8000-0000000000a2', 'vizinho-oraculo@test.local');
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('0acb0000-0000-4000-8000-0000000000b1', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000a1', 'Ator', 'member', true),
  ('0acb0000-0000-4000-8000-0000000000b2', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000a2', 'Vizinho', 'member', true);
INSERT INTO public.member_feature_permissions
  (team_member_id, organization_id, feature_key, enabled)
VALUES
  ('0acb0000-0000-4000-8000-0000000000b1', '0acb0000-0000-4000-8000-000000000001', 'leads.edit', false),
  ('0acb0000-0000-4000-8000-0000000000b1', '0acb0000-0000-4000-8000-000000000001', 'pipeline.move_cards', true),
  ('0acb0000-0000-4000-8000-0000000000b1', '0acb0000-0000-4000-8000-000000000001', 'followups.create', true),
  ('0acb0000-0000-4000-8000-0000000000b1', '0acb0000-0000-4000-8000-000000000001', 'leads.reassign', true);

INSERT INTO public.oraculo_conversations
  (id, organization_id, user_id, team_member_id, title)
VALUES
  ('0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1', 'Ações');
INSERT INTO public.oraculo_turns
  (id, conversation_id, organization_id, user_id, role, content)
VALUES
  ('0acb0000-0000-4000-8000-0000000000d1', '0acb0000-0000-4000-8000-0000000000c1',
   '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000a1',
   'assistant', 'Proponho etiquetar os leads.');
INSERT INTO public.leads (id, organization_id, name, responsible_id) VALUES
  ('0acb0000-0000-4000-8000-0000000000e1', '0acb0000-0000-4000-8000-000000000001',
   'Lead um', '0acb0000-0000-4000-8000-0000000000b1'),
  ('0acb0000-0000-4000-8000-0000000000e2', '0acb0000-0000-4000-8000-000000000001',
   'Lead dois', '0acb0000-0000-4000-8000-0000000000b1');
INSERT INTO public.tags (id, organization_id, name) VALUES
  ('0acb0000-0000-4000-8000-0000000000f1', '0acb0000-0000-4000-8000-000000000001', 'Primeira'),
  ('0acb0000-0000-4000-8000-0000000000f2', '0acb0000-0000-4000-8000-000000000001', 'Segunda'),
  ('0acb0000-0000-4000-8000-0000000000f3', '0acb0000-0000-4000-8000-000000000001', 'Terceira');

SELECT is(
  (public.oraculo_preview_action_proposal(
    '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000b1',
    'adicionar_tag', '{"tipo":"leads_sem_contato","dias":0}', '{"tag":"Primeira"}')
    ->>'previsao')::int,
  2, '(PREVIEW) contagem é a fotografia antes do clique');
SELECT is(
  public.oraculo_preview_action_proposal(
    '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000b1',
    'adicionar_tag', '{"tipo":"leads_sem_contato","dias":0}', '{"tag":"Primeira"}')
    ->'parametros_resolvidos'->>'tag_name',
  'Primeira', '(PREVIEW) servidor resolve id e mantém nome revisável pela pessoa');

SELECT public.oraculo_save_turn(
  '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-000000000001',
  '0acb0000-0000-4000-8000-0000000000a1', NULL, 'Etiquete os parados',
  '{"text":"Proposta pronta","toolsUsed":["propor_acao"],"rejectedToolCalls":[],"hitToolCeiling":false,"telemetry":{"model":"test","inputTokens":1,"outputTokens":1,"latencyMs":1},"proposals":[{"kind":"oraculo_action_proposal","id":"0acb0000-0000-4000-8000-000000000100","acao":"adicionar_tag","criterio":{"tipo":"leads_sem_contato","dias":0},"parametros":{"tag_id":"0acb0000-0000-4000-8000-0000000000f1","tag_name":"Primeira"},"previsao":2,"status":"pendente"}]}'::jsonb,
  NULL);
SELECT is((SELECT count(*) FROM public.oraculo_action_proposals
  WHERE id = '0acb0000-0000-4000-8000-000000000100')::int, 1,
  '(PERSISTÊNCIA) proposta nasce atômica com o turno do assistente');
SELECT is((SELECT count(*) FROM public.lead_tags)::int, 0,
  '(PUREZA) persistir proposta não altera CRM');
INSERT INTO public.oraculo_action_proposals
  (id, organization_id, conversation_id, turn_id, proposed_by, scope_team_member_id,
   action_type, criterion, parameters, preview_count)
VALUES
  ('0acb0000-0000-4000-8000-000000000101', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1',
   '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1',
   'adicionar_tag', '{"tipo":"leads_sem_contato","dias":0}',
   '{"tag_id":"0acb0000-0000-4000-8000-0000000000f1","tag_name":"Primeira"}', 2),
  ('0acb0000-0000-4000-8000-000000000102', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1',
   '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1',
   'adicionar_tag', '{"tipo":"leads_sem_contato","dias":0}',
   '{"tag_id":"0acb0000-0000-4000-8000-0000000000f2","tag_name":"Segunda"}', 2),
  ('0acb0000-0000-4000-8000-000000000103', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1',
   '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1',
   'adicionar_tag', '{"tipo":"leads_sem_contato","dias":0}',
   '{"tag_id":"0acb0000-0000-4000-8000-0000000000f3","tag_name":"Terceira"}', 1);

SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';

SELECT throws_ok(
  $q$ SELECT public.execute_oraculo_action_proposal(
    '0acb0000-0000-4000-8000-000000000101'::uuid,
    '0acb0000-0000-4000-8000-000000000001'::uuid) $q$,
  '42501', NULL,
  '(PERMISSÃO) clique sem leads.edit é recusado no backend');

RESET role;
UPDATE public.member_feature_permissions SET enabled = true
WHERE team_member_id = '0acb0000-0000-4000-8000-0000000000b1' AND feature_key = 'leads.edit';
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';
CREATE TEMP TABLE first_result AS
SELECT public.execute_oraculo_action_proposal(
  '0acb0000-0000-4000-8000-000000000101'::uuid,
  '0acb0000-0000-4000-8000-000000000001'::uuid) AS value;
SELECT is((SELECT value->>'alterados' FROM first_result)::int, 2,
  '(AÇÃO) clique autorizado altera os dois alvos atuais');
RESET role;

SELECT is((SELECT count(*) FROM public.lead_history
  WHERE metadata->>'proposal_id' = '0acb0000-0000-4000-8000-000000000101')::int, 2,
  '(AUDITORIA) cada mudança cria histórico do lead');
SELECT is((SELECT min(created_by::text) FROM public.lead_history
  WHERE metadata->>'proposal_id' = '0acb0000-0000-4000-8000-000000000101'),
  '0acb0000-0000-4000-8000-0000000000a1',
  '(IDENTIDADE) histórico registra a pessoa que clicou');
SELECT is((SELECT min(source) FROM public.lead_history
  WHERE metadata->>'proposal_id' = '0acb0000-0000-4000-8000-000000000101'),
  'manual', '(IDENTIDADE) confirmação humana fica marcada como manual');

-- O segundo lead deixa de cumprir o critério depois da previsão.
SET LOCAL session_replication_role = replica;
INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('0acb0000-0000-4000-8000-000000000201', '0acb0000-0000-4000-8000-000000000001',
   'Funil teste', 'funil-acao-oraculo-t', 'custom');
INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES
  ('0acb0000-0000-4000-8000-000000000202', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-000000000201', 'contatado', 'Contatado', 0, 'open');
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
VALUES
  ('0acb0000-0000-4000-8000-000000000203', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-000000000201', '0acb0000-0000-4000-8000-0000000000e2',
   '0acb0000-0000-4000-8000-000000000202', 'contatado', now(), now());
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';
CREATE TEMP TABLE changed_result AS
SELECT public.execute_oraculo_action_proposal(
  '0acb0000-0000-4000-8000-000000000102'::uuid,
  '0acb0000-0000-4000-8000-000000000001'::uuid) AS value;
SELECT is((SELECT value->>'alterados' FROM changed_result)::int, 1,
  '(TOCTOU) só o alvo que ainda cumpre o critério é alterado');
SELECT is((SELECT value->>'ja_tratados' FROM changed_result)::int, 1,
  '(TOCTOU) alvo mudado desde a previsão é reportado como já tratado');
RESET role;

-- Agora nenhum alvo continua elegível.
SET LOCAL session_replication_role = replica;
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
VALUES
  ('0acb0000-0000-4000-8000-000000000204', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-000000000201', '0acb0000-0000-4000-8000-0000000000e1',
   '0acb0000-0000-4000-8000-000000000202', 'contatado', now(), now());
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';
CREATE TEMP TABLE empty_result AS
SELECT public.execute_oraculo_action_proposal(
  '0acb0000-0000-4000-8000-000000000103'::uuid,
  '0acb0000-0000-4000-8000-000000000001'::uuid) AS value;
SELECT is((SELECT value->>'status' FROM empty_result), 'aviso',
  '(VAZIO) nenhum alvo elegível gera aviso');
SELECT is((SELECT value->>'alterados' FROM empty_result)::int, 0,
  '(VAZIO) aviso não fabrica alteração');
RESET role;

-- Outra pessoa da mesma org não vê nem executa a proposta.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a2","role":"authenticated"}';
SELECT is((SELECT count(*) FROM public.oraculo_action_proposals)::int, 0,
  '(RLS) colega não lê propostas alheias');
SELECT throws_ok(
  $q$ SELECT public.execute_oraculo_action_proposal(
    '0acb0000-0000-4000-8000-000000000101'::uuid,
    '0acb0000-0000-4000-8000-000000000001'::uuid) $q$,
  '42501', NULL,
  '(SEGURANÇA) colega não executa proposta alheia');
RESET role;

-- Os três outros verbos do primeiro catálogo executam pela mesma fronteira.
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.leads (id, organization_id, name, responsible_id) VALUES
  ('0acb0000-0000-4000-8000-0000000000e3', '0acb0000-0000-4000-8000-000000000001', 'Lead mover', '0acb0000-0000-4000-8000-0000000000b1'),
  ('0acb0000-0000-4000-8000-0000000000e4', '0acb0000-0000-4000-8000-000000000001', 'Lead follow-up', '0acb0000-0000-4000-8000-0000000000b1'),
  ('0acb0000-0000-4000-8000-0000000000e5', '0acb0000-0000-4000-8000-000000000001', 'Lead atribuir', '0acb0000-0000-4000-8000-0000000000b1');
INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('0acb0000-0000-4000-8000-000000000301', '0acb0000-0000-4000-8000-000000000001', 'Funil ações', 'funil-acoes-t', 'custom');
INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES
  ('0acb0000-0000-4000-8000-000000000302', '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-000000000301', 'entrada', 'Entrada', 0, 'open'),
  ('0acb0000-0000-4000-8000-000000000303', '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-000000000301', 'negociacao', 'Negociação', 1, 'open');
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
VALUES
  ('0acb0000-0000-4000-8000-000000000304', '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-000000000301', '0acb0000-0000-4000-8000-0000000000e3', '0acb0000-0000-4000-8000-000000000302', 'entrada', now() - interval '30 days', now() - interval '30 days');
INSERT INTO public.oraculo_action_proposals
  (id, organization_id, conversation_id, turn_id, proposed_by, scope_team_member_id, action_type, criterion, parameters, preview_count)
VALUES
  ('0acb0000-0000-4000-8000-000000000104', '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1', '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1', 'mover_etapa', '{"tipo":"leads_parados","dias":14}', '{"pipeline_id":"0acb0000-0000-4000-8000-000000000301","target_stage_id":"0acb0000-0000-4000-8000-000000000303","target_stage_key":"negociacao","target_stage_name":"Negociação"}', 1),
  ('0acb0000-0000-4000-8000-000000000105', '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1', '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1', 'criar_follow_up', '{"tipo":"leads_sem_contato","dias":0}', '{"titulo":"Retomar contato","prazo_dias":2}', 2),
  ('0acb0000-0000-4000-8000-000000000106', '0acb0000-0000-4000-8000-000000000001', '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1', '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1', 'atribuir_responsavel', '{"tipo":"leads_sem_contato","dias":0}', '{"team_member_id":"0acb0000-0000-4000-8000-0000000000b2","team_member_name":"Vizinho"}', 2);
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';
SELECT public.execute_oraculo_action_proposal('0acb0000-0000-4000-8000-000000000104', '0acb0000-0000-4000-8000-000000000001');
SELECT public.execute_oraculo_action_proposal('0acb0000-0000-4000-8000-000000000105', '0acb0000-0000-4000-8000-000000000001');
SELECT public.execute_oraculo_action_proposal('0acb0000-0000-4000-8000-000000000106', '0acb0000-0000-4000-8000-000000000001');
RESET role;
SELECT is((SELECT stage_key FROM public.pipeline_entries WHERE id = '0acb0000-0000-4000-8000-000000000304'),
  'negociacao', '(CATÁLOGO) mover etapa altera id e chave canônica');
SELECT is((SELECT count(*) FROM public.follow_ups WHERE title = 'Retomar contato')::int,
  2, '(CATÁLOGO) criar follow-up materializa tarefa para alvos atuais');
SELECT is((SELECT count(*) FROM public.leads WHERE id IN ('0acb0000-0000-4000-8000-0000000000e4','0acb0000-0000-4000-8000-0000000000e5')
  AND responsible_id = '0acb0000-0000-4000-8000-0000000000b2')::int,
  2, '(CATÁLOGO) atribuir responsável atualiza alvos atuais');

-- O destino também pode mudar entre preview e clique. A proposta expira sem
-- escrever quando a etapa deixa de estar ativa.
INSERT INTO public.oraculo_action_proposals
  (id, organization_id, conversation_id, turn_id, proposed_by, scope_team_member_id,
   action_type, criterion, parameters, preview_count)
VALUES
  ('0acb0000-0000-4000-8000-000000000107', '0acb0000-0000-4000-8000-000000000001',
   '0acb0000-0000-4000-8000-0000000000c1', '0acb0000-0000-4000-8000-0000000000d1',
   '0acb0000-0000-4000-8000-0000000000a1', '0acb0000-0000-4000-8000-0000000000b1',
   'mover_etapa', '{"tipo":"leads_parados","dias":14}',
   '{"pipeline_id":"0acb0000-0000-4000-8000-000000000301","target_stage_id":"0acb0000-0000-4000-8000-000000000303","target_stage_key":"negociacao"}', 1);
UPDATE public.pipeline_stages SET is_active = false
WHERE id = '0acb0000-0000-4000-8000-000000000303';
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"0acb0000-0000-4000-8000-0000000000a1","role":"authenticated"}';
CREATE TEMP TABLE stale_destination_result AS
SELECT public.execute_oraculo_action_proposal(
  '0acb0000-0000-4000-8000-000000000107'::uuid,
  '0acb0000-0000-4000-8000-000000000001'::uuid) AS value;
RESET role;
SELECT is((SELECT value->>'codigo' FROM stale_destination_result), 'destino_indisponivel',
  '(TOCTOU) destino desativado depois do preview bloqueia a escrita');
SELECT is((SELECT status FROM public.oraculo_action_proposals
  WHERE id = '0acb0000-0000-4000-8000-000000000107'), 'expired',
  '(TOCTOU) proposta com destino obsoleto expira');

SELECT * FROM finish();
ROLLBACK;
