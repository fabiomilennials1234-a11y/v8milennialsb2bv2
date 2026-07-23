-- supabase/tests/sale_events_producer_identity_test.sql
--
-- ISSUE #1199 — identidade de produtor e chave de idempotência no livro-razão.
--
-- Prova:
--   (a) colunas producer/origin_record_id existem; producer retroage a 'funnel'
--   (b) CHAVE DE IDEMPOTÊNCIA barra segunda venda e segundo estorno da mesma
--       origem, e NÃO barra venda+estorno da mesma origem (tipos diferentes)
--   (c) CHECK de coerência: funil SEM funil é barrado; carteira SEM funil passa
--   (d) vocabulário fechado de produtor
--   (e) produtor sem funil é obrigado a declarar origem
--   (f) ISENÇÃO DE DATA: carteira preserva sold_at mantendo source='trigger';
--       funil segue normalizado
--   (g) leitores canônicos com linha SEM funil (auditoria da issue)
--
-- Roda inteiro dentro de transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(23);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'sale_events', 'producer',         '(a) coluna producer existe');
SELECT has_column('public', 'sale_events', 'origin_record_id', '(a) coluna origin_record_id existe');
SELECT col_not_null('public', 'sale_events', 'producer',       '(a) producer é NOT NULL');
SELECT col_default_is('public', 'sale_events', 'producer', 'funnel',
  '(a) producer retroage a "funnel" pelo DEFAULT — sem UPDATE, que a imutabilidade proíbe');

SELECT col_is_null('public', 'sale_events', 'pipeline_id', '(a) pipeline_id passou a aceitar NULL');
SELECT col_is_null('public', 'sale_events', 'stage_key',   '(a) stage_key passou a aceitar NULL');

SELECT has_index('public', 'sale_events', 'uq_sale_events_producer_origin_event',
  '(a) chave de idempotência existe');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('11991199-aaaa-0000-0000-000000001199', 'Org A (#1199)', 'org-a-1199-spi', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('11991199-1111-0000-0000-000000001199', '11991199-aaaa-0000-0000-000000001199', 'Lead #1199')
ON CONFLICT (id) DO NOTHING;

-- Usuário + vínculo ATIVO: os leitores canônicos passam por assert_org_access
-- (#1209), que desde aquela fatia exige vínculo ativo. Sem isto o bloco (g)
-- morre em access_denied antes de exercitar o que interessa.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('11991199-9999-0000-0000-000000001199', 'membro-1199@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('11991199-8888-0000-0000-000000001199', '11991199-aaaa-0000-0000-000000001199',
   '11991199-9999-0000-0000-000000001199', 'Membro #1199', 'admin', true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (b) CHAVE DE IDEMPOTÊNCIA
-- ---------------------------------------------------------------------------
-- Primeira venda do pedido: passa.
SELECT lives_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
     sale_value, currency, revenue_stream, source, producer, origin_record_id)
  VALUES
    ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
     NULL, NULL, 'sale', '2026-04-01 10:00:00-03', 1000, 'BRL', 'carteira',
     'trigger', 'carteira', '11991199-0d01-0000-0000-000000001199')
$$, '(b) primeira venda do pedido de Carteira entra');

-- Segunda venda do MESMO pedido: barrada por construção.
SELECT throws_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
     sale_value, currency, revenue_stream, source, producer, origin_record_id)
  VALUES
    ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
     NULL, NULL, 'sale', '2026-04-01 10:00:00-03', 1000, 'BRL', 'carteira',
     'trigger', 'carteira', '11991199-0d01-0000-0000-000000001199')
$$, '23505', NULL,
  '(b) SEGUNDA venda do mesmo pedido é BARRADA — dinheiro não duplica');

-- Estorno do mesmo pedido: tipo diferente, então PASSA. A chave é por tipo de
-- evento; sem isto o estorno seria barrado junto e o pedido ficaria sem como
-- ser desfeito.
SELECT lives_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type,
     reversed_event_id, sold_at, sale_value, currency, revenue_stream, source,
     producer, origin_record_id)
  SELECT
    '11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
    NULL, NULL, 'sale_reversed', se.id, '2026-04-10 10:00:00-03', 1000, 'BRL',
    'carteira', 'trigger', 'carteira', '11991199-0d01-0000-0000-000000001199'
  FROM public.sale_events se
  WHERE se.origin_record_id = '11991199-0d01-0000-0000-000000001199'
    AND se.event_type = 'sale'
$$, '(b) ESTORNO do mesmo pedido passa — a chave é por tipo de evento');

-- Segundo estorno do mesmo pedido: barrado.
SELECT throws_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type,
     reversed_event_id, sold_at, sale_value, currency, revenue_stream, source,
     producer, origin_record_id)
  SELECT
    '11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
    NULL, NULL, 'sale_reversed', se.id, '2026-04-11 10:00:00-03', 1000, 'BRL',
    'carteira', 'trigger', 'carteira', '11991199-0d01-0000-0000-000000001199'
  FROM public.sale_events se
  WHERE se.origin_record_id = '11991199-0d01-0000-0000-000000001199'
    AND se.event_type = 'sale'
$$, '23505', NULL, '(b) SEGUNDO estorno do mesmo pedido é BARRADO');

-- ---------------------------------------------------------------------------
-- (c) CHECK de coerência produtor × funil
-- ---------------------------------------------------------------------------
SELECT throws_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
     sale_value, currency, revenue_stream, source, producer)
  VALUES
    ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
     NULL, NULL, 'sale', '2026-04-02 10:00:00-03', 500, 'BRL', 'novo_negocio',
     'trigger', 'funnel')
$$, '23514', NULL,
  '(c) produtor de FUNIL sem funil é BARRADO — afrouxar NOT NULL não virou vale-tudo');

SELECT lives_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
     sale_value, currency, revenue_stream, source, producer, origin_record_id)
  VALUES
    ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
     NULL, NULL, 'sale', '2026-04-03 10:00:00-03', 700, 'BRL', 'carteira',
     'trigger', 'carteira', '11991199-0d02-0000-0000-000000001199')
$$, '(c) produtor CARTEIRA sem funil passa');

-- ---------------------------------------------------------------------------
-- (d) Vocabulário fechado
-- ---------------------------------------------------------------------------
SELECT throws_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
     sale_value, currency, revenue_stream, source, producer, origin_record_id)
  VALUES
    ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
     NULL, NULL, 'sale', '2026-04-04 10:00:00-03', 100, 'BRL', 'novo_negocio',
     'trigger', 'produtor_inventado', '11991199-0d03-0000-0000-000000001199')
$$, '23514', NULL, '(d) produtor fora do vocabulário é BARRADO');

-- ---------------------------------------------------------------------------
-- (e) Origem obrigatória fora do funil
-- ---------------------------------------------------------------------------
SELECT throws_ok($$
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
     sale_value, currency, revenue_stream, source, producer)
  VALUES
    ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
     NULL, NULL, 'sale', '2026-04-05 10:00:00-03', 100, 'BRL', 'carteira',
     'trigger', 'carteira')
$$, '23514', NULL,
  '(e) carteira SEM origem é BARRADA — sem origem a chave de idempotência não pega');

-- ---------------------------------------------------------------------------
-- (f) ISENÇÃO DE DATA — o ponto delicado da fatia
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT sold_at FROM public.sale_events
    WHERE origin_record_id = '11991199-0d02-0000-0000-000000001199'),
  '2026-04-03 10:00:00-03'::timestamptz,
  '(f) carteira PRESERVA sold_at próprio, apesar de source=trigger');

SELECT is(
  (SELECT source FROM public.sale_events
    WHERE origin_record_id = '11991199-0d02-0000-0000-000000001199'),
  'trigger',
  '(f) e a fonte SEGUE "trigger" — não fugimos pela fonte, que desligaria comissão');

-- Contraprova: o funil continua normalizado. Se esta falhar, a isenção vazou
-- para quem não devia e o livro perde a âncora do funil.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, currency, revenue_stream, source, producer)
VALUES
  ('11991199-aaaa-0000-0000-000000001199','11991199-1111-0000-0000-000000001199',
   gen_random_uuid(), 'vendido', 'sale', '2020-01-01 00:00:00-03', 900, 'BRL',
   'novo_negocio', 'trigger', 'funnel');

SELECT ok(
  (SELECT sold_at FROM public.sale_events
    WHERE producer = 'funnel' AND sale_value = 900) > '2026-01-01'::timestamptz,
  '(f) contraprova: o FUNIL segue normalizado para now() — isenção não vazou');

-- ---------------------------------------------------------------------------
-- (g) AUDITORIA DOS LEITORES CANÔNICOS com linha SEM funil
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11991199-9999-0000-0000-000000001199","role":"authenticated"}', true);

-- get_sales_metrics SEM filtro de funil: a receita de Carteira ENTRA no total
-- da org. Se não entrasse, a Carteira sumiria do dashboard.
SELECT ok(
  (public.get_sales_metrics(
     '11991199-aaaa-0000-0000-000000001199','month','2026-04-15') ->> 'revenue_total')::numeric > 0,
  '(g) get_sales_metrics SEM filtro INCLUI linha sem funil');

-- COM filtro de funil: a linha de Carteira SAI — ela não pertence a funil
-- nenhum, e `NULL = <uuid>` é NULL, então o predicado a exclui.
SELECT is(
  (public.get_sales_metrics(
     '11991199-aaaa-0000-0000-000000001199','month','2026-04-15',
     NULL, NULL, gen_random_uuid()) ->> 'revenue_total')::numeric,
  0::numeric,
  '(g) get_sales_metrics COM filtro de funil EXCLUI linha sem funil');

SELECT lives_ok($$
  SELECT public.get_ranking('11991199-aaaa-0000-0000-000000001199','month','2026-04-15')
$$, '(g) get_ranking não quebra com linha sem funil');

SELECT lives_ok($$
  SELECT public.get_commission_ledger('11991199-aaaa-0000-0000-000000001199','month','2026-04-15')
$$, '(g) get_commission_ledger não quebra — não referencia funil nem etapa');

SELECT throws_ok($$
  SELECT public.get_funnel_flow('11991199-aaaa-0000-0000-000000001199', NULL, 'month', '2026-04-15')
$$, '22023', NULL,
  '(g) get_funnel_flow segue exigindo funil — linha sem funil nunca o alcança');

SELECT * FROM finish();

ROLLBACK;
