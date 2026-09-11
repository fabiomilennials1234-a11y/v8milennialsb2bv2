-- SCRUM-603 · briefing diário do admin.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_table('public', 'oraculo_admin_briefings', '(CONTRATO) briefing persistido existe');
SELECT has_function(
  'public', 'generate_oraculo_admin_briefings', ARRAY['timestamp with time zone', 'integer'],
  '(CONTRATO) geração diária em lote existe'
);
SELECT has_function(
  'public', 'oraculo_open_admin_briefing', ARRAY['uuid', 'uuid', 'uuid'],
  '(CONTRATO) abertura contextual existe'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.oraculo_admin_briefings', 'SELECT'),
  '(SEGURANÇA) navegador não lê briefings de outras organizações'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.oraculo_open_admin_briefing(uuid,uuid,uuid)', 'EXECUTE'),
  '(SEGURANÇA) abertura explícita fica atrás da edge autenticada'
);
SELECT ok(
  public.oraculo_admin_briefing_stagger_minute('a6030000-0000-4000-8000-000000000001') BETWEEN 0 AND 59,
  '(CADÊNCIA) minuto escalonado sempre fica dentro da hora'
);
SELECT is(
  public.oraculo_admin_briefing_due_at(
    'a6030000-0000-4000-8000-000000000001', 'America/Sao_Paulo',
    '2026-09-10 09:59:00+00'
  ), false,
  '(FUSO) antes das 07h locais nunca está vencido'
);
SELECT is(
  public.oraculo_admin_briefing_due_at(
    'a6030000-0000-4000-8000-000000000001', 'America/Sao_Paulo',
    '2026-09-10 11:00:00+00'
  ), true,
  '(FUSO) após a janela escalonada das 07h está vencido'
);
SELECT is(
  public.oraculo_admin_briefing_headline('{"status":"none"}'::jsonb), NULL,
  '(SILÊNCIO) sem gargalo não existe texto de briefing'
);
SELECT ok(
  public.oraculo_admin_briefing_headline(
    '{"status":"bottleneck","bottleneck":{"label":"Propostas","estimated_leaked_revenue":12500}}'
  ) LIKE 'Gargalo em Propostas:%',
  '(CONTEÚDO) headline vem do diagnóstico determinístico'
);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
UPDATE public.organizations SET is_sandbox = true;

INSERT INTO public.organizations
  (id, name, slug, timezone, subscription_status, is_sandbox)
VALUES
  ('a6030000-0000-4000-8000-000000000001', 'Org Briefing', 'org-briefing-t', 'America/Sao_Paulo', 'active', false),
  ('a6030000-0000-4000-8000-000000000002', 'Org Sem Gargalo', 'org-sem-gargalo-t', 'America/Sao_Paulo', 'active', false);
INSERT INTO auth.users (id, email) VALUES
  ('a6030000-0000-4000-8000-0000000000a1', 'admin-briefing@test.local'),
  ('a6030000-0000-4000-8000-0000000000a2', 'member-briefing@test.local');
INSERT INTO public.team_members
  (id, organization_id, user_id, name, role, is_active)
VALUES
  ('a6030000-0000-4000-8000-0000000000b1', 'a6030000-0000-4000-8000-000000000001',
   'a6030000-0000-4000-8000-0000000000a1', 'Admin', 'admin', true),
  ('a6030000-0000-4000-8000-0000000000b2', 'a6030000-0000-4000-8000-000000000001',
   'a6030000-0000-4000-8000-0000000000a2', 'Member', 'member', true);

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('a6030000-0000-4000-8000-0000000000c1', 'a6030000-0000-4000-8000-000000000001',
   'Funil Briefing', 'funil-briefing-t', 'custom');
INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES
  ('a6030000-0000-4000-8000-0000000000c2', 'a6030000-0000-4000-8000-000000000001',
   'a6030000-0000-4000-8000-0000000000c1', 'proposta', 'Propostas', 1, 'open');
INSERT INTO public.leads (id, organization_id, name, created_at) VALUES
  ('a6030000-0000-4000-8000-0000000000d1', 'a6030000-0000-4000-8000-000000000001', 'Lead parado', now() - interval '20 days');
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
VALUES
  ('a6030000-0000-4000-8000-0000000000d2', 'a6030000-0000-4000-8000-000000000001',
   'a6030000-0000-4000-8000-0000000000c1', 'a6030000-0000-4000-8000-0000000000d1',
   'a6030000-0000-4000-8000-0000000000c2', 'proposta', now() - interval '20 days', now() - interval '20 days');

INSERT INTO public.oraculo_admin_briefings (
  id, organization_id, local_date, headline, diagnostic,
  initial_leaked_revenue, created_at, expires_at
) VALUES (
  'a6030000-0000-4000-8000-0000000000e1',
  'a6030000-0000-4000-8000-000000000001', current_date,
  'Gargalo em Propostas: cerca de R$ 12.500 em receita vazada.',
  '{"status":"bottleneck","bottleneck":{"dimension":"stage","key":"proposta","label":"Propostas","estimated_leaked_revenue":12500}}',
  12500, now(), now() + interval '24 hours'
);
SET LOCAL session_replication_role = origin;

SELECT is(
  public.oraculo_admin_briefing_current(
    'a6030000-0000-4000-8000-000000000001', 'a6030000-0000-4000-8000-0000000000a1'
  )->>'id',
  'a6030000-0000-4000-8000-0000000000e1',
  '(ESCOPO) admin lê o briefing da própria organização'
);
SELECT is(
  public.oraculo_admin_briefing_current(
    'a6030000-0000-4000-8000-000000000001', 'a6030000-0000-4000-8000-0000000000a2'
  ), NULL,
  '(ESCOPO) member não recebe briefing do admin'
);

CREATE TEMP TABLE first_open AS
SELECT public.oraculo_open_admin_briefing(
  'a6030000-0000-4000-8000-0000000000e1',
  'a6030000-0000-4000-8000-000000000001',
  'a6030000-0000-4000-8000-0000000000a1'
) AS value;
CREATE TEMP TABLE second_open AS
SELECT public.oraculo_open_admin_briefing(
  'a6030000-0000-4000-8000-0000000000e1',
  'a6030000-0000-4000-8000-000000000001',
  'a6030000-0000-4000-8000-0000000000a1'
) AS value;

SELECT is((SELECT value->>'conversa_id' FROM first_open),
  (SELECT value->>'conversa_id' FROM second_open),
  '(IDEMPOTÊNCIA) reabrir usa a mesma conversa contextual');
SELECT is((SELECT count(*) FROM public.oraculo_admin_briefing_conversations)::integer, 1,
  '(IDEMPOTÊNCIA) briefing cria uma conversa por admin');
SELECT is((SELECT status FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000000e1'), 'seen',
  '(CICLO) abrir muda novo para visto');
SELECT is((SELECT model FROM public.oraculo_turns
  WHERE conversation_id = (SELECT (value->>'conversa_id')::uuid FROM first_open)), NULL,
  '(CUSTO) briefing determinístico não consome modelo');
SELECT ok((SELECT tools_used @> ARRAY['gargalo'] FROM public.oraculo_turns
  WHERE conversation_id = (SELECT (value->>'conversa_id')::uuid FROM first_open)),
  '(LASTRO) conversa registra a procedência do gargalo');
SELECT is((SELECT count(*) FROM public.oraculo_action_proposals
  WHERE briefing_id = 'a6030000-0000-4000-8000-0000000000e1')::integer, 1,
  '(AÇÃO) briefing leva proposta executável com confirmação');

UPDATE public.oraculo_action_proposals
SET status = 'executed', executed_at = now(), execution_result = '{"status":"sucesso","alterados":1}'
WHERE briefing_id = 'a6030000-0000-4000-8000-0000000000e1';
SELECT is((SELECT status FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000000e1'), 'acted',
  '(CICLO) confirmação marca briefing como agido');
SELECT ok((SELECT acted_by_click_at IS NOT NULL FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000000e1'),
  '(MÉTRICA) clique fica instrumentado separadamente');
SELECT is(public.oraculo_admin_briefing_metrics(now() - interval '1 day')->>'open_rate_pct', '100.0',
  '(MÉTRICA) taxa de abertura está disponível');

UPDATE public.oraculo_admin_briefings
SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
WHERE id = 'a6030000-0000-4000-8000-0000000000e1';
SELECT is(public.oraculo_admin_briefing_current(
  'a6030000-0000-4000-8000-000000000001', 'a6030000-0000-4000-8000-0000000000a1'
), NULL, '(EXPIRAÇÃO) briefing some após 24 horas');

CREATE TEMP TABLE no_bottleneck_run AS
SELECT public.generate_oraculo_admin_briefings(
  ((current_date + time '23:59') AT TIME ZONE 'America/Sao_Paulo'), 25
) AS value;
SELECT is((SELECT value->>'model_calls' FROM no_bottleneck_run), '0',
  '(CUSTO) lote não chama modelo');
SELECT is((SELECT count(*) FROM public.oraculo_admin_briefings
  WHERE organization_id = 'a6030000-0000-4000-8000-000000000002')::integer, 0,
  '(SILÊNCIO) organização sem gargalo não ganha card nem registro de briefing');
SELECT is((SELECT count(*) FROM public.oraculo_admin_briefing_runs
  WHERE organization_id = 'a6030000-0000-4000-8000-000000000002')::integer, 1,
  '(IDEMPOTÊNCIA) ledger técnico impede recalcular ausência no mesmo dia');

-- A medição de 72h só dá crédito quando o vazamento cai por avanço. Queda por
-- Lead perdido fica separada e não transforma apodrecimento em sucesso.
UPDATE public.oraculo_admin_briefings
SET created_at = now() - interval '73 hours', expires_at = now() - interval '49 hours',
    status = 'expired'
WHERE id = 'a6030000-0000-4000-8000-0000000000e1';
INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES
  ('a6030000-0000-4000-8000-0000000000c3', 'a6030000-0000-4000-8000-000000000001',
   'a6030000-0000-4000-8000-0000000000c1', 'negociacao', 'Negociação', 2, 'open');
INSERT INTO public.pipeline_stage_events
  (id, organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, source)
VALUES
  ('a6030000-0000-4000-8000-0000000000f1', 'a6030000-0000-4000-8000-000000000001',
   'a6030000-0000-4000-8000-0000000000d1', 'a6030000-0000-4000-8000-0000000000c1',
   'proposta', 'negociacao', now() - interval '60 hours', 'trigger');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('a6030000-0000-4000-8000-0000000001c1', 'a6030000-0000-4000-8000-000000000002',
   'Funil Apodrecido', 'funil-apodrecido-t', 'custom');
INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES
  ('a6030000-0000-4000-8000-0000000001c2', 'a6030000-0000-4000-8000-000000000002',
   'a6030000-0000-4000-8000-0000000001c1', 'proposta', 'Propostas', 1, 'open'),
  ('a6030000-0000-4000-8000-0000000001c3', 'a6030000-0000-4000-8000-000000000002',
   'a6030000-0000-4000-8000-0000000001c1', 'perdido', 'Perdido', 2, 'lost');
INSERT INTO public.leads (id, organization_id, name, created_at) VALUES
  ('a6030000-0000-4000-8000-0000000001d1', 'a6030000-0000-4000-8000-000000000002',
   'Lead apodrecido', now() - interval '80 hours');
INSERT INTO public.pipeline_stage_events
  (id, organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, source)
VALUES
  ('a6030000-0000-4000-8000-0000000001f1', 'a6030000-0000-4000-8000-000000000002',
   'a6030000-0000-4000-8000-0000000001d1', 'a6030000-0000-4000-8000-0000000001c1',
   'proposta', 'perdido', now() - interval '60 hours', 'trigger');
INSERT INTO public.oraculo_admin_briefings (
  id, organization_id, local_date, status, headline, diagnostic,
  initial_leaked_revenue, created_at, expires_at
) VALUES (
  'a6030000-0000-4000-8000-0000000001e1', 'a6030000-0000-4000-8000-000000000002',
  current_date - 1, 'expired', 'Gargalo em Propostas.',
  '{"status":"bottleneck","bottleneck":{"dimension":"stage","key":"proposta","label":"Propostas","estimated_leaked_revenue":12500}}',
  12500, now() - interval '73 hours', now() - interval '49 hours'
);

CREATE OR REPLACE FUNCTION public.oraculo_revenue_bottleneck(
  p_organization_id uuid, p_team_member_id uuid
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT '{"status":"bottleneck","bottleneck":{"dimension":"stage","key":"proposta","label":"Propostas","estimated_leaked_revenue":5000}}'::jsonb
$$;
SELECT public.measure_oraculo_admin_briefing_shrinkage(now(), 25);

SELECT is((SELECT shrinkage_outcome FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000000e1'), 'improved',
  '(72H) vazamento menor com avanço conta como melhora');
SELECT is((SELECT progressed_leads FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000000e1'), 1,
  '(72H) avanço fica medido separadamente');
SELECT is((SELECT shrinkage_outcome FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000001e1'), 'decayed',
  '(72H) vazamento menor por Lead perdido não vira mérito do Oráculo');
SELECT is((SELECT decayed_leads FROM public.oraculo_admin_briefings
  WHERE id = 'a6030000-0000-4000-8000-0000000001e1'), 1,
  '(72H) apodrecimento fica medido separadamente');
SELECT is(public.oraculo_admin_briefing_metrics(now() - interval '7 days')->>'shrinkage_rate_pct', '50.0',
  '(MÉTRICA) taxa de encolhimento usa somente melhora real');

SELECT * FROM finish();
ROLLBACK;
