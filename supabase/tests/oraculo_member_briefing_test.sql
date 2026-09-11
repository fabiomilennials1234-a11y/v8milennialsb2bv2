-- SCRUM-605 · briefing semanal do member.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

SELECT has_table('public','oraculo_member_briefings','(CONTRATO) briefing semanal existe');
SELECT has_function('public','generate_oraculo_member_briefings',ARRAY['timestamp with time zone','integer'],'(CONTRATO) gerador semanal existe');
SELECT ok(NOT has_table_privilege('authenticated','public.oraculo_member_briefings','SELECT'),'(ACL) navegador não lê tabela server-only');
SELECT ok(NOT has_function_privilege('authenticated','public.oraculo_member_briefing_worklist(uuid,uuid)','EXECUTE'),'(ACL) navegador não consulta fila privada diretamente');
SELECT is(public.oraculo_member_briefing_due_at('America/Sao_Paulo','2026-09-14 11:00+00'),true,'(CADÊNCIA) segunda após 07h local está vencida');
SELECT is(public.oraculo_member_briefing_due_at('America/Sao_Paulo','2026-09-14 09:59+00'),false,'(CADÊNCIA) segunda antes de 07h local aguarda');
SELECT is(public.oraculo_member_briefing_due_at('America/Sao_Paulo','2026-09-15 11:00+00'),true,'(RESILIÊNCIA) terça recupera execução perdida');

SET LOCAL role postgres;
SET LOCAL session_replication_role=replica;
UPDATE public.organizations SET is_sandbox=true;
INSERT INTO public.organizations(id,name,slug,timezone,subscription_status,is_sandbox) VALUES
 ('a6050000-0000-4000-8000-000000000001','Org 605','org-605','America/Sao_Paulo','active',false);
INSERT INTO auth.users(id,email) VALUES
 ('a6050000-0000-4000-8000-000000000011','eu-605@test.local'),
 ('a6050000-0000-4000-8000-000000000012','colega-605@test.local'),
 ('a6050000-0000-4000-8000-000000000013','sem-gargalo-605@test.local');
INSERT INTO public.team_members(id,organization_id,user_id,name,role,is_active,metric_type) VALUES
 ('a6050000-0000-4000-8000-000000000021','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000011','Eu','member',true,'sales'),
 ('a6050000-0000-4000-8000-000000000022','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000012','Colega Secreto','member',true,'sales'),
 ('a6050000-0000-4000-8000-000000000023','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000013','Sem Gargalo','member',true,'sales');
INSERT INTO public.oraculo_member_briefings(
 id,organization_id,team_member_id,week_start,headline,diagnostic,created_at,expires_at
) VALUES (
 'a6050000-0000-4000-8000-000000000031','a6050000-0000-4000-8000-000000000001',
 'a6050000-0000-4000-8000-000000000021','2026-09-14','Seu funil pede atenção nesta semana.',
 '{"status":"bottleneck","bottleneck":{"dimension":"self","key":"self","label":"Seu desempenho","comparison_basis":"team_median"},"self_profile":[{"subject":"self","comparison_basis":"team_median","team_sample_size":4}],"worklist":{"unanswered_proposals":[{"lead_id":"a6050000-0000-4000-8000-000000000041","lead_name":"Proposta Minha","waiting_days":5}],"stalled_leads":[{"lead_id":"a6050000-0000-4000-8000-000000000042","lead_name":"Lead Meu Parado","stalled_days":20}]}}'::jsonb,
 now(),now()+interval '7 days');
INSERT INTO public.leads(id,organization_id,name,responsible_id) VALUES
 ('a6050000-0000-4000-8000-000000000041','a6050000-0000-4000-8000-000000000001','Proposta Minha','a6050000-0000-4000-8000-000000000021'),
 ('a6050000-0000-4000-8000-000000000042','a6050000-0000-4000-8000-000000000001','Lead Meu Parado','a6050000-0000-4000-8000-000000000021'),
 ('a6050000-0000-4000-8000-000000000043','a6050000-0000-4000-8000-000000000001','Lead do Colega','a6050000-0000-4000-8000-000000000022');
INSERT INTO public.pipelines(id,organization_id,name,slug,type) VALUES
 ('a6050000-0000-4000-8000-000000000051','a6050000-0000-4000-8000-000000000001','Propostas','propostas-605','custom');
INSERT INTO public.pipeline_stages(id,organization_id,pipeline_id,pipeline_type,stage_key,name,position) VALUES
 ('a6050000-0000-4000-8000-000000000052','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000051','custom','proposta-enviada','Proposta enviada',0),
 ('a6050000-0000-4000-8000-000000000053','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000051','custom','negociacao','Negociação',1);
INSERT INTO public.pipeline_entries(id,organization_id,pipeline_id,lead_id,stage_id,stage_key,stage_changed_at) VALUES
 ('a6050000-0000-4000-8000-000000000061','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000051','a6050000-0000-4000-8000-000000000041','a6050000-0000-4000-8000-000000000052','proposta-enviada',now()-interval '20 days'),
 ('a6050000-0000-4000-8000-000000000062','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000051','a6050000-0000-4000-8000-000000000042','a6050000-0000-4000-8000-000000000053','negociacao',now()-interval '20 days'),
 ('a6050000-0000-4000-8000-000000000063','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000051','a6050000-0000-4000-8000-000000000043','a6050000-0000-4000-8000-000000000052','proposta-enviada',now()-interval '20 days');
INSERT INTO public.whatsapp_messages
 (id,organization_id,message_id,remote_jid,phone_number,direction,message_type,content,lead_id,timestamp) VALUES
 (gen_random_uuid(),'a6050000-0000-4000-8000-000000000001','m-605-own','x@s.w','5511900000605','outgoing','text','proposta','a6050000-0000-4000-8000-000000000041',now()-interval '5 days'),
 (gen_random_uuid(),'a6050000-0000-4000-8000-000000000001','m-605-peer','y@s.w','5511900000606','outgoing','text','proposta','a6050000-0000-4000-8000-000000000043',now()-interval '5 days');
SET LOCAL session_replication_role=origin;

CREATE TEMP TABLE worklist AS SELECT public.oraculo_member_briefing_worklist(
 'a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000021') value;
SELECT is((SELECT value->'unanswered_proposals'->0->>'lead_name' FROM worklist),'Proposta Minha','(FILA) mostra proposta própria sem resposta');
SELECT ok((SELECT value::text NOT LIKE '%Lead do Colega%' FROM worklist),'(PRIVACIDADE) fila não revela lead atribuído ao colega');
SELECT is((SELECT value->'stalled_leads'->0->>'lead_name' FROM worklist),'Proposta Minha','(FILA) ordena leads próprios parados');
SELECT ok((SELECT value::text LIKE '%Lead Meu Parado%' FROM worklist),'(FILA) inclui lead próprio parado sem próximo passo');

CREATE TEMP TABLE mine AS SELECT public.oraculo_member_briefing_current(
 'a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000011') value;
SELECT is((SELECT value->>'id' FROM mine),'a6050000-0000-4000-8000-000000000031','(ESCOPO) member lê só briefing próprio');
SELECT is(public.oraculo_member_briefing_current(
 'a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000012'),NULL,'(ESCOPO) colega não lê briefing alheio');
SELECT throws_ok(
 $$ SELECT public.oraculo_open_member_briefing(
   'a6050000-0000-4000-8000-000000000031','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000012') $$,
 '42501',NULL,'(ESCOPO) colega não abre briefing alheio');
SELECT ok((SELECT value::text NOT LIKE '%Colega Secreto%' FROM mine),'(PRIVACIDADE) resposta não contém nome de colega');
SELECT is((SELECT value->'bottleneck'->>'dimension' FROM mine),'self','(PRIVACIDADE) dimensão recebida é self');
SELECT is((SELECT expires_at-created_at FROM public.oraculo_member_briefings WHERE id='a6050000-0000-4000-8000-000000000031'),interval '7 days','(EXPIRAÇÃO) vida útil exata de sete dias');

CREATE TEMP TABLE first_open AS SELECT public.oraculo_open_member_briefing(
 'a6050000-0000-4000-8000-000000000031','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000011') value;
CREATE TEMP TABLE second_open AS SELECT public.oraculo_open_member_briefing(
 'a6050000-0000-4000-8000-000000000031','a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000011') value;
SELECT is((SELECT value->>'conversa_id' FROM first_open),(SELECT value->>'conversa_id' FROM second_open),'(IDEMPOTÊNCIA) reabertura usa mesma conversa');
SELECT is((SELECT team_member_id::text FROM public.oraculo_conversations WHERE id=(SELECT (value->>'conversa_id')::uuid FROM first_open)),'a6050000-0000-4000-8000-000000000021','(ESCOPO) conversa nasce vinculada ao próprio member');
SELECT ok((SELECT content LIKE '%Proposta Minha%' FROM public.oraculo_turns WHERE conversation_id=(SELECT (value->>'conversa_id')::uuid FROM first_open) AND role='assistant'),'(CONTEÚDO) conversa lista proposta própria sem resposta');
SELECT ok((SELECT content LIKE '%Lead Meu Parado%' AND content NOT LIKE '%Lead do Colega%' FROM public.oraculo_turns WHERE conversation_id=(SELECT (value->>'conversa_id')::uuid FROM first_open) AND role='assistant'),'(CONTEÚDO) conversa lista lead próprio sem vazar colega');

CREATE TEMP TABLE generation AS SELECT public.generate_oraculo_member_briefings('2026-09-14 12:00+00',100) value;
SELECT is((SELECT value->>'model_calls' FROM generation),'0','(CUSTO) lote semanal não chama modelo');
SELECT is((SELECT count(*) FROM public.oraculo_member_briefing_runs WHERE team_member_id='a6050000-0000-4000-8000-000000000023')::integer,1,'(SILÊNCIO) ausência vira ledger sem card');
SELECT * FROM finish();
ROLLBACK;
