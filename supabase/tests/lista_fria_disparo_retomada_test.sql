-- supabase/tests/lista_fria_disparo_retomada_test.sql
--
-- Lista Fria · "Importar e Disparar" retoma de onde parou (migration 20271225000000).
--
-- Caso de produção (03/11): o pedido importou 81 contatos, abriu 81 negócios e
-- falhou antes de criar o plano de envio. A busca ficou sem nada para importar e o
-- botão não tinha como voltar.
--
--   (GR) grants: pendentes só para service_role; aguardando para quem está logado
--   (PE) pendentes: o que entra na retomada e o que NÃO entra
--   (AG) aguardando: o número que a tela mostra
--   (RE) preparar: soma o que falta importar ao que ficou pela metade
--
-- Personas: a1 admin da org A (flag ligada), b1 admin da org B (flag desligada).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('22f1a000-0000-4000-8000-00000000000a', 'Org RT A', 'org-rt-a', 'America/Sao_Paulo'),
  ('22f1a000-0000-4000-8000-00000000000b', 'Org RT B', 'org-rt-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"lista_fria": true}'::jsonb
 WHERE id = '22f1a000-0000-4000-8000-00000000000a';

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('22f1a000-0000-4000-8000-0000000000a1', 'rt-admin-a@test.local'),
    ('22f1a000-0000-4000-8000-0000000000b1', 'rt-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('22f1a000-0000-4000-8000-0000000001a1', '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000000a1', 'Admin A', 'admin', true),
  ('22f1a000-0000-4000-8000-0000000001b1', '22f1a000-0000-4000-8000-00000000000b', '22f1a000-0000-4000-8000-0000000000b1', 'Admin B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, is_active) VALUES
  ('22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-00000000000a', 'Prospecção', 'prospeccao-rt', true);

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, is_active, is_final_positive, is_final_negative) VALUES
  ('22f1a000-0000-4000-8000-0000000004a1', '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000003a1', 'novo', 'Novo', 1, true, false, false);

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider, reserved_for) VALUES
  ('22f1a000-0000-4000-8000-0000000005a1', '22f1a000-0000-4000-8000-00000000000a', 'comum', 'uazapi', NULL);

-- BA: busca com 1 contato ainda por importar (r7) e vários já importados por pedidos antigos.
-- BC: o caso de produção, SÓ contatos aguardando (nada por importar).
INSERT INTO public.lista_fria_buscas (id, organization_id, fonte, nicho, cidade, status, creditos_limite, finished_at) VALUES
  ('22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-00000000000a', 'maps', 'Contabilidade', 'Florianópolis', 'concluida', 10, now()),
  ('22f1a000-0000-4000-8000-0000000006c1', '22f1a000-0000-4000-8000-00000000000a', 'maps', 'Dentistas',     'Florianópolis', 'concluida', 10, now());

-- Leads. L6 está na lixeira.
INSERT INTO public.leads (id, organization_id, name, deleted_at) VALUES
  ('22f1a000-0000-4000-8000-0000000007a1', '22f1a000-0000-4000-8000-00000000000a', 'L1 com negócio',  NULL),
  ('22f1a000-0000-4000-8000-0000000007a2', '22f1a000-0000-4000-8000-00000000000a', 'L2 sem negócio',  NULL),
  ('22f1a000-0000-4000-8000-0000000007a3', '22f1a000-0000-4000-8000-00000000000a', 'L3 pedido com plano', NULL),
  ('22f1a000-0000-4000-8000-0000000007a4', '22f1a000-0000-4000-8000-00000000000a', 'L4 importado antes', NULL),
  ('22f1a000-0000-4000-8000-0000000007a5', '22f1a000-0000-4000-8000-00000000000a', 'L5 já no plano',  NULL),
  ('22f1a000-0000-4000-8000-0000000007a6', '22f1a000-0000-4000-8000-00000000000a', 'L6 na lixeira',   now()),
  ('22f1a000-0000-4000-8000-0000000007a7', '22f1a000-0000-4000-8000-00000000000a', 'L7 do pedido corrente', NULL),
  ('22f1a000-0000-4000-8000-0000000007a8', '22f1a000-0000-4000-8000-00000000000a', 'L8 caso de produção', NULL),
  ('22f1a000-0000-4000-8000-0000000007a9', '22f1a000-0000-4000-8000-00000000000a', 'L9 caso de produção', NULL);

-- L1 já tem negócio no funil; L8 também (o que a produção tinha: 1 card com negócio por lead).
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, stage_key, lead_id, deal_id) VALUES
  (gen_random_uuid(), '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000003a1', 'novo', '22f1a000-0000-4000-8000-0000000007a1', gen_random_uuid()),
  (gen_random_uuid(), '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000003a1', 'novo', '22f1a000-0000-4000-8000-0000000007a8', gen_random_uuid()),
  (gen_random_uuid(), '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000003a1', 'novo', '22f1a000-0000-4000-8000-0000000007a9', gen_random_uuid());

-- Resultados da BA. Referência de tempo: base = 2 h atrás.
INSERT INTO public.lista_fria_resultados
  (organization_id, busca_id, ref_externa, nome, telefone, ja_e_lead, selecionado, lead_id, importado_em) VALUES
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r1', 'Um',    '48999990001', false, true, '22f1a000-0000-4000-8000-0000000007a1', now() - interval '115 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r2', 'Dois',  '48999990002', false, true, '22f1a000-0000-4000-8000-0000000007a2', now() - interval '115 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r3', 'Três',  '48999990003', false, true, '22f1a000-0000-4000-8000-0000000007a3', now() - interval '85 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r4', 'Quatro','48999990004', false, true, '22f1a000-0000-4000-8000-0000000007a4', now() - interval '180 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r5', 'Cinco', '48999990005', false, true, '22f1a000-0000-4000-8000-0000000007a5', now() - interval '115 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r6', 'Seis',  '48999990006', false, true, '22f1a000-0000-4000-8000-0000000007a6', now() - interval '115 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1', 'r7', 'Sete',  '48999990007', false, true, NULL, NULL);

-- Resultados da BC: 2 contatos já importados, nenhum por importar.
INSERT INTO public.lista_fria_resultados
  (organization_id, busca_id, ref_externa, nome, telefone, ja_e_lead, selecionado, lead_id, importado_em) VALUES
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006c1', 'c1', 'Oito', '48999990008', false, true, '22f1a000-0000-4000-8000-0000000007a8', now() - interval '20 minutes'),
  ('22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006c1', 'c2', 'Nove', '48999990009', false, true, '22f1a000-0000-4000-8000-0000000007a9', now() - interval '20 minutes');

-- Pedidos antigos da BA:
--   F1  falhou SEM plano, janela [-120 min, -110 min]   → entra na retomada
--   F2  falhou COM plano (P2), janela [-90, -80]        → não entra (o plano é dono)
-- Pedido antigo da BC:
--   F4  falhou SEM plano, janela [-30, -10]             → o caso de produção
INSERT INTO public.lista_fria_disparos
  (id, organization_id, busca_id, pipeline_id, stage_id, mensagem, instance_ids,
   delay_min_ms, delay_max_ms, status, total_previsto, plan_id, erro, created_at, finished_at, ultimo_sinal_em) VALUES
  ('22f1a000-0000-4000-8000-0000000008a1', '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1',
   '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1', 'Oi',
   ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000, 'falhou', 4, NULL, 'disparando: No organization',
   now() - interval '120 minutes', now() - interval '110 minutes', now() - interval '110 minutes'),
  ('22f1a000-0000-4000-8000-0000000008a2', '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1',
   '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1', 'Oi',
   ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000, 'falhou', 1, '22f1a000-0000-4000-8000-0000000009a2', 'disparando: 1º lote falhou',
   now() - interval '90 minutes', now() - interval '80 minutes', now() - interval '80 minutes'),
  ('22f1a000-0000-4000-8000-0000000008c1', '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006c1',
   '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1', 'Oi',
   ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000, 'falhou', 2, NULL, 'disparando: No organization',
   now() - interval '30 minutes', now() - interval '10 minutes', now() - interval '10 minutes');

-- L5 já é destinatário do plano P2 (de um pedido desta busca), mesmo tendo sido importado na janela de F1.
INSERT INTO public.blast_plan_recipients (plan_id, lead_id) VALUES
  ('22f1a000-0000-4000-8000-0000000009a2', '22f1a000-0000-4000-8000-0000000007a5');

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(NOT has_function_privilege('authenticated', 'public.lista_fria_disparo_pendentes(uuid, uuid, uuid)', 'EXECUTE'),
  'GR1: authenticated não chama pendentes (lista leads de qualquer busca)');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_disparo_pendentes(uuid, uuid, uuid)', 'EXECUTE'),
  'GR2: anon não chama pendentes');
SELECT ok(has_function_privilege('service_role', 'public.lista_fria_disparo_pendentes(uuid, uuid, uuid)', 'EXECUTE'),
  'GR3: service_role chama pendentes (a edge function)');
SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_disparo_aguardando(uuid)', 'EXECUTE'),
  'GR4: authenticated chama aguardando (a tela)');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_disparo_aguardando(uuid)', 'EXECUTE'),
  'GR5: anon não chama aguardando');

-- ===========================================================================
-- (PE) pendentes
-- ===========================================================================
SELECT is(
  (SELECT array_agg(lead_id ORDER BY lead_id)
     FROM public.lista_fria_disparo_pendentes(
       '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)),
  ARRAY['22f1a000-0000-4000-8000-0000000007a1', '22f1a000-0000-4000-8000-0000000007a2']::uuid[],
  'PE1: só entram L1 e L2 — importados na janela de um pedido que falhou sem plano');

SELECT is(
  (SELECT tem_negocio FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a1'),
  true, 'PE2: L1 já tem negócio no funil (não ganha outro)');

SELECT is(
  (SELECT tem_negocio FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a2'),
  false, 'PE3: L2 não tem negócio (a edge function abre um)');

SELECT is(
  (SELECT tem_negocio FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a9', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a1'),
  false, 'PE4: negócio em OUTRO funil não conta como negócio neste');

SELECT is(
  (SELECT count(*)::int FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a3'),
  0, 'PE5: L3, importado por um pedido que JÁ criou plano, não volta');

SELECT is(
  (SELECT count(*)::int FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a4'),
  0, 'PE6: L4, importado fora de qualquer pedido (importação simples), não é disparado sem pedir');

SELECT is(
  (SELECT count(*)::int FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a5'),
  0, 'PE7: L5, já destinatário de plano desta busca, não recebe duas vezes');

SELECT is(
  (SELECT count(*)::int FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)
    WHERE lead_id = '22f1a000-0000-4000-8000-0000000007a6'),
  0, 'PE8: lead na lixeira não é disparado');

-- O pedido corrente: um lead importado agora entra pela janela dele, sem depender de F1.
SET LOCAL session_replication_role = replica;
INSERT INTO public.lista_fria_disparos
  (id, organization_id, busca_id, pipeline_id, stage_id, mensagem, instance_ids,
   delay_min_ms, delay_max_ms, status, total_previsto, created_at, ultimo_sinal_em) VALUES
  ('22f1a000-0000-4000-8000-0000000008a3', '22f1a000-0000-4000-8000-00000000000a', '22f1a000-0000-4000-8000-0000000006a1',
   '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1', 'Oi',
   ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000, 'importando', 1,
   now() - interval '5 minutes', now());
UPDATE public.lista_fria_resultados
   SET lead_id = '22f1a000-0000-4000-8000-0000000007a7', importado_em = now() - interval '1 minute'
 WHERE busca_id = '22f1a000-0000-4000-8000-0000000006a1' AND ref_externa = 'r7';
SET LOCAL session_replication_role = origin;

SELECT is(
  (SELECT count(*)::int FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1',
     '22f1a000-0000-4000-8000-0000000008a3')),
  3, 'PE9: com o pedido corrente, entram L7 (recém-importado) + L1 e L2 (retomada)');

SELECT is(
  (SELECT count(*)::int FROM public.lista_fria_disparo_pendentes(
     '22f1a000-0000-4000-8000-0000000006a1', '22f1a000-0000-4000-8000-0000000003a1', NULL)),
  2, 'PE10: sem informar o pedido corrente, o recém-importado de OUTRA janela não aparece');

-- Desfaz o pedido corrente e o r7 para os testes de preparar.
SET LOCAL session_replication_role = replica;
DELETE FROM public.lista_fria_disparos WHERE id = '22f1a000-0000-4000-8000-0000000008a3';
UPDATE public.lista_fria_resultados SET lead_id = NULL, importado_em = NULL
 WHERE busca_id = '22f1a000-0000-4000-8000-0000000006a1' AND ref_externa = 'r7';
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (AG) aguardando
-- ===========================================================================
SET LOCAL role authenticated;

SELECT pg_temp.as_user('22f1a000-0000-4000-8000-0000000000b1');
SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_aguardando('22f1a000-0000-4000-8000-0000000006a1')$$,
  NULL, NULL, 'AG1: admin de outra org não vê quantos aguardam na busca alheia');

SELECT pg_temp.as_user('22f1a000-0000-4000-8000-0000000000a1');
SELECT is(public.lista_fria_disparo_aguardando('22f1a000-0000-4000-8000-0000000006a1'), 2,
  'AG2: a BA tem 2 aguardando (L1 e L2)');
SELECT is(public.lista_fria_disparo_aguardando('22f1a000-0000-4000-8000-0000000006c1'), 2,
  'AG3: a BC (caso de produção) tem 2 aguardando');
SELECT is(public.lista_fria_disparo_aguardando('22f1a000-0000-4000-8000-0000000000ff'), 0,
  'AG4: busca inexistente devolve 0, não erro');

-- ===========================================================================
-- (RE) preparar soma importáveis + aguardando
-- ===========================================================================

-- O caso de produção: 0 por importar, 2 aguardando. Antes da correção isto dava nada_para_importar.
SELECT is(
  (public.lista_fria_disparo_preparar('22f1a000-0000-4000-8000-0000000006c1',
      '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1',
      'Oi {{primeiro_nome}}', ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000) ->> 'total')::int,
  2, 'RE1: busca só com contatos aguardando abre pedido para eles (o caso de produção)');

SET LOCAL role postgres;
SELECT is((SELECT total_previsto FROM public.lista_fria_disparos
            WHERE busca_id = '22f1a000-0000-4000-8000-0000000006c1' AND status = 'importando'),
  2, 'RE2: o pedido guarda o total previsto da retomada');
SET LOCAL role authenticated;
SELECT pg_temp.as_user('22f1a000-0000-4000-8000-0000000000a1');

-- BA: 1 por importar (r7) + 2 aguardando = 3.
SELECT is(
  (public.lista_fria_disparo_preparar('22f1a000-0000-4000-8000-0000000006a1',
      '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000) ->> 'total')::int,
  3, 'RE3: total = o que falta importar (1) + o que aguarda (2)');

SET LOCAL role postgres;
SELECT is((SELECT count(*)::int FROM public.lista_fria_disparos
            WHERE busca_id = '22f1a000-0000-4000-8000-0000000006a1' AND status = 'importando'),
  1, 'RE4: um pedido ativo por busca');
SET LOCAL role authenticated;
SELECT pg_temp.as_user('22f1a000-0000-4000-8000-0000000000a1');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f1a000-0000-4000-8000-0000000006c1',
      '22f1a000-0000-4000-8000-0000000003a1', '22f1a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f1a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT409', NULL, 'RE5: clicar de novo na retomada não abre um segundo pedido');

SELECT * FROM finish();
ROLLBACK;
