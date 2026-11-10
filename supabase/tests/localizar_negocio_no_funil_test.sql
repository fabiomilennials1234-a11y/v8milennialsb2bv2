-- supabase/tests/localizar_negocio_no_funil_test.sql
--
-- "Ir para o negócio": a RPC traz o card de UM negócio no formato da coluna e
-- diz se o recorte do board o mostra (migration
-- 20280104000500_localizar_negocio_no_funil.sql).
--
--   (ES) estrutura: INVOKER, search_path '', sem EXECUTE para PUBLIC/anon, e os
--        nomes dos filtros iguais aos do get_pipeline_page.
--   (LO) localiza: card fundo (posição 41 de 50), grupo empatado no mesmo
--        created_at, negócio ganho, linha == a do get_pipeline_page.
--   (RE) recorte: busca e responsável (com co-dono) escondem/mostram;
--        escondido devolve só a localização.
--   (PR) propriedade: para TODO card da etapa, visivel_no_recorte ⇔ o card
--        está no get_pipeline_page da etapa com o mesmo recorte.
--   (RL) RLS: membro com "só os meus" não acha card alheio; acha o dele —
--        inclusive no grupo empatado com irmãs invisíveis dos dois lados (e uma
--        entre o card e a próxima visível); a propriedade (PR) vale para ele;
--        usuário de outra org é recusado; card de outra org não aparece.
--
-- Seed como na Café Jurerê: lead_owners_n_donos, etapa "Vendido" open +
-- is_final_positive, ganho vindo de deals.outcome. Roda em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('1f0c0001-0000-4000-8000-00000000000a', 'Org LN A', 'org-ln-a', 'America/Sao_Paulo', '{"lead_owners_n_donos": true}'::jsonb),
  ('1f0c0001-0000-4000-8000-00000000000b', 'Org LN B', 'org-ln-b', 'America/Sao_Paulo', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

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
    ('1f0c0001-0000-4000-8000-0000000000a1', 'ln-admin-a@test.local'),
    ('1f0c0001-0000-4000-8000-0000000000a2', 'ln-vend2-a@test.local'),
    ('1f0c0001-0000-4000-8000-0000000000a3', 'ln-vend3-a@test.local'),
    ('1f0c0001-0000-4000-8000-0000000000b1', 'ln-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('1f0c0001-0000-4000-8000-0000000001a1', '1f0c0001-0000-4000-8000-00000000000a', '1f0c0001-0000-4000-8000-0000000000a1', 'Admin LN A', 'admin',  true),
  ('1f0c0001-0000-4000-8000-0000000001a2', '1f0c0001-0000-4000-8000-00000000000a', '1f0c0001-0000-4000-8000-0000000000a2', 'Vend 2',     'member', true),
  ('1f0c0001-0000-4000-8000-0000000001a3', '1f0c0001-0000-4000-8000-00000000000a', '1f0c0001-0000-4000-8000-0000000000a3', 'Vend 3',     'member', true),
  ('1f0c0001-0000-4000-8000-0000000001b1', '1f0c0001-0000-4000-8000-00000000000b', '1f0c0001-0000-4000-8000-0000000000b1', 'Admin LN B', 'admin',  true)
ON CONFLICT (id) DO NOTHING;

-- 50 leads: pares do Vend 2, ímpares do Vend 3. "Lead 01" … "Lead 50".
INSERT INTO public.leads (id, organization_id, name, erp_code, sale_responsible_id, created_at)
SELECT ('1f0c0002-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       '1f0c0001-0000-4000-8000-00000000000a',
       'Lead ' || lpad(n::text, 2, '0'),
       (9000 + n)::text,
       CASE WHEN n % 2 = 0 THEN '1f0c0001-0000-4000-8000-0000000001a2' ELSE '1f0c0001-0000-4000-8000-0000000001a3' END::uuid,
       '2026-08-01'
  FROM generate_series(1, 50) AS n;

-- Lead 51 (ganho, Vend 3) e o lead da org B.
INSERT INTO public.leads (id, organization_id, name, sale_responsible_id, created_at) VALUES
  ('1f0c0002-0000-4000-8000-000000000033', '1f0c0001-0000-4000-8000-00000000000a', 'Lead Ganho', '1f0c0001-0000-4000-8000-0000000001a3', '2026-08-01'),
  ('1f0c0002-0000-4000-8000-0000000000bb', '1f0c0001-0000-4000-8000-00000000000b', 'Lead B',     '1f0c0001-0000-4000-8000-0000000001b1', '2026-08-01');

-- Lead 11 (Vend 3) tem o Vend 2 como CO-dono. Leads: prefixo 1f0c0002, id = n em hex.
INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source) VALUES
  ('1f0c0001-0000-4000-8000-00000000000a', '1f0c0002-0000-4000-8000-00000000000b', '1f0c0001-0000-4000-8000-0000000001a2', 'co', false, 'manual');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('1f0c0001-0000-4000-8000-0000000003a1', '1f0c0001-0000-4000-8000-00000000000a', 'Funil LN A', 'funil-ln-a', 'custom'),
  ('1f0c0001-0000-4000-8000-0000000003b1', '1f0c0001-0000-4000-8000-00000000000b', 'Funil LN B', 'funil-ln-b', 'custom');

INSERT INTO public.pipeline_stages (pipeline_id, stage_key, name, position, stage_role, is_final_positive, is_final_negative) VALUES
  ('1f0c0001-0000-4000-8000-0000000003a1', 'novo',    'Novo',    0, 'open', false, false),
  ('1f0c0001-0000-4000-8000-0000000003a1', 'vendido', 'Vendido', 1, 'open', true,  false),
  ('1f0c0001-0000-4000-8000-0000000003b1', 'novo',    'Novo',    0, 'open', false, false);

INSERT INTO public.deals (id, organization_id, title, source, outcome, value, outcome_at) VALUES
  ('1f0c0001-0000-4000-8000-0000000005a1', '1f0c0001-0000-4000-8000-00000000000a', 'D ganho', 'human', 'won', 700, '2026-10-20 15:00-03');

-- Etapa "novo": 45 cards de hora em hora (Lead 01 … Lead 45) e um GRUPO
-- EMPATADO de 5 (Lead 46 … Lead 50) nascidos no mesmo instante, como num
-- import em lote — entre o Lead 20 e o Lead 21 na ordem da coluna.
-- Ids dos cards: …0000000003e9 + n (1001 + n − 1).
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata, created_at)
SELECT ('1f0c0001-0000-4000-8000-' || lpad(to_hex(1000 + n), 12, '0'))::uuid,
       '1f0c0001-0000-4000-8000-00000000000a',
       '1f0c0001-0000-4000-8000-0000000003a1',
       ('1f0c0002-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       'novo',
       '{}'::jsonb,
       CASE WHEN n <= 45 THEN '2026-08-01 00:00:00+00'::timestamptz + make_interval(hours => n)
            ELSE '2026-08-01 20:30:00+00'::timestamptz END
  FROM generate_series(1, 50) AS n;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, deal_id, stage_key, metadata, created_at) VALUES
  ('1f0c0001-0000-4000-8000-0000000007a1', '1f0c0001-0000-4000-8000-00000000000a', '1f0c0001-0000-4000-8000-0000000003a1', '1f0c0002-0000-4000-8000-000000000033', '1f0c0001-0000-4000-8000-0000000005a1', 'vendido', '{}', '2026-08-05'),
  ('1f0c0001-0000-4000-8000-0000000007b1', '1f0c0001-0000-4000-8000-00000000000b', '1f0c0001-0000-4000-8000-0000000003b1', '1f0c0002-0000-4000-8000-0000000000bb', NULL, 'novo', '{}', '2026-08-05');

-- "Só os meus" no Funil para o Vend 2 (o admin passa pelo papel).
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('1f0c0001-0000-4000-8000-0000000001a2', '1f0c0001-0000-4000-8000-00000000000a', 'pipeline.view_all', false);

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (ES) estrutura
-- ===========================================================================
SELECT has_function('public', 'localizar_negocio_no_funil',
  ARRAY['uuid','uuid','text','uuid','uuid[]','text[]','text','text','timestamp with time zone','timestamp with time zone','timestamp with time zone','timestamp with time zone','text[]','timestamp with time zone','text[]','text[]','boolean','text[]','text[]','integer','integer'],
  'ES1: assinatura com os filtros do board');

SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     FROM pg_proc p WHERE p.proname = 'localizar_negocio_no_funil'),
  'ES2: SECURITY INVOKER e search_path vazio');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.proname = 'localizar_negocio_no_funil' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
  'ES3: PUBLIC sem EXECUTE');

SELECT is(
  has_function_privilege('anon', (SELECT oid FROM pg_proc WHERE proname = 'localizar_negocio_no_funil'), 'EXECUTE'),
  false, 'ES4: anon sem EXECUTE');

SELECT is(
  has_function_privilege('authenticated', (SELECT oid FROM pg_proc WHERE proname = 'localizar_negocio_no_funil'), 'EXECUTE'),
  true, 'ES5: authenticated com EXECUTE');

SELECT is(
  (SELECT array_agg(n ORDER BY n) FROM unnest((SELECT p.proargnames[1:p.pronargs] FROM pg_proc p WHERE p.proname = 'localizar_negocio_no_funil')) AS n WHERE n <> 'p_entry_id'),
  (SELECT array_agg(n ORDER BY n) FROM unnest((SELECT p.proargnames[1:p.pronargs] FROM pg_proc p WHERE p.proname = 'get_pipeline_page')) AS n
    WHERE n NOT IN ('p_pipeline_slug','p_stage_id','p_page_size','p_cursor','p_cursor_id','p_pipeline_id','p_rating_min','p_rating_max','p_calor_min','p_calor_max')),
  'ES6: os filtros têm os MESMOS nomes do get_pipeline_page (o board manda o mesmo objeto aos dois)');

-- ===========================================================================
-- Como o admin da org A
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"1f0c0001-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- (LO) o Lead 10 está na posição 41 de 50 — página 3 da coluna.
SELECT is(
  (SELECT count(*)::int FROM public.get_pipeline_page(p_org_id => '1f0c0001-0000-4000-8000-00000000000a', p_pipeline_id => '1f0c0001-0000-4000-8000-0000000003a1', p_stage_id => 'novo', p_page_size => 1000) g
    WHERE g.created_at > '2026-08-01 10:00:00+00'),
  40, 'LO0: sanidade — 40 cards vêm antes do Lead 10 na coluna');

SELECT is(
  (SELECT (l.stage_key, l.visivel_no_recorte, l.lead ->> 'name')::text
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f2', '1f0c0001-0000-4000-8000-00000000000a') l),
  '(novo,t,"Lead 10")', 'LO1: acha o card fundo, na etapa certa, visível, com o lead');

SELECT results_eq(
  $$SELECT l.id, l.pipeline_id, l.lead_id, l.stage_key, l.assigned_to, l.notes, l.metadata, l.entered_at, l.stage_changed_at, l.created_at, l.updated_at, l.lead
      FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f2', '1f0c0001-0000-4000-8000-00000000000a') l$$,
  $$SELECT g.id, g.pipeline_id, g.lead_id, g.stage_key, g.assigned_to, g.notes, g.metadata, g.entered_at, g.stage_changed_at, g.created_at, g.updated_at, g.lead
      FROM public.get_pipeline_page(p_org_id => '1f0c0001-0000-4000-8000-00000000000a', p_pipeline_id => '1f0c0001-0000-4000-8000-0000000003a1', p_stage_id => 'novo', p_page_size => 1000) g
     WHERE g.id = '1f0c0001-0000-4000-8000-0000000003f2'$$,
  'LO2: a linha é exatamente a que a coluna mostraria');

SELECT is(
  (SELECT string_agg(right(e.id::text, 3) || '=' || (l.visivel_no_recorte)::text, ',' ORDER BY e.id)
     FROM public.pipeline_entries e
     CROSS JOIN LATERAL public.localizar_negocio_no_funil(e.id, '1f0c0001-0000-4000-8000-00000000000a') l
    WHERE e.created_at = '2026-08-01 20:30:00+00'),
  '416=true,417=true,418=true,419=true,41a=true',
  'LO3: os 5 do grupo empatado no mesmo instante são achados, um por um');

SELECT is(
  (SELECT (l.stage_key, l.visivel_no_recorte, l.metadata ->> 'deal_outcome')::text
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000007a1', '1f0c0001-0000-4000-8000-00000000000a') l),
  '(vendido,t,won)', 'LO4: negócio ganho vem com o desfecho no metadata (o board o tira da pilha)');

SELECT is(
  (SELECT count(*)::int FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-00000000dead', '1f0c0001-0000-4000-8000-00000000000a')),
  0, 'LO5: negócio inexistente = nenhuma linha');

SELECT is(
  (SELECT count(*)::int FROM public.localizar_negocio_no_funil(NULL, '1f0c0001-0000-4000-8000-00000000000a')),
  0, 'LO6: sem negócio = nenhuma linha');

-- (RE) recorte
SELECT is(
  (SELECT (l.stage_key, l.visivel_no_recorte, l.lead IS NULL, l.metadata IS NULL)::text
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f2', '1f0c0001-0000-4000-8000-00000000000a', p_search => 'Lead 3') l),
  '(novo,f,t,t)', 'RE1: a busca esconde — devolve só onde ele está, sem a linha');

SELECT is(
  (SELECT l.visivel_no_recorte
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f2', '1f0c0001-0000-4000-8000-00000000000a', p_search => '9010') l),
  true, 'RE2: busca pelo código do ERP acha (mesma regra da coluna)');

SELECT is(
  (SELECT l.visivel_no_recorte
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f3', '1f0c0001-0000-4000-8000-00000000000a', p_responsible_id => '1f0c0001-0000-4000-8000-0000000001a2') l),
  true, 'RE3: "Meus" do Vend 2 mostra o Lead 11, de que ele é co-dono');

SELECT is(
  (SELECT l.visivel_no_recorte
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003eb', '1f0c0001-0000-4000-8000-00000000000a', p_responsible_id => '1f0c0001-0000-4000-8000-0000000001a2') l),
  false, 'RE4: "Meus" do Vend 2 esconde o Lead 03, só do Vend 3');

SELECT is(
  (SELECT l.visivel_no_recorte
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-000000000418', '1f0c0001-0000-4000-8000-00000000000a', p_search => 'Lead 47') l),
  false, 'RE5: no grupo empatado, a busca que acha a IRMÃ (Lead 47) não acha o card (Lead 48)');

SELECT is(
  (SELECT l.visivel_no_recorte
     FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003e9', '1f0c0001-0000-4000-8000-00000000000a', p_search => 'Lead 50') l),
  false, 'RE6: card no fundo da coluna, recorte sem nenhum aprovado abaixo dele');

-- (PR) propriedade, em três recortes
SELECT set_eq(
  $$SELECT e.id FROM public.pipeline_entries e
     WHERE e.pipeline_id = '1f0c0001-0000-4000-8000-0000000003a1' AND e.stage_key = 'novo'
       AND (SELECT l.visivel_no_recorte FROM public.localizar_negocio_no_funil(e.id, '1f0c0001-0000-4000-8000-00000000000a') l)$$,
  $$SELECT g.id FROM public.get_pipeline_page(p_org_id => '1f0c0001-0000-4000-8000-00000000000a', p_pipeline_id => '1f0c0001-0000-4000-8000-0000000003a1', p_stage_id => 'novo', p_page_size => 1000) g$$,
  'PR1: sem filtro, visível ⇔ está na coluna');

SELECT set_eq(
  $$SELECT e.id FROM public.pipeline_entries e
     WHERE e.pipeline_id = '1f0c0001-0000-4000-8000-0000000003a1' AND e.stage_key = 'novo'
       AND (SELECT l.visivel_no_recorte FROM public.localizar_negocio_no_funil(e.id, '1f0c0001-0000-4000-8000-00000000000a', p_search => 'Lead 1') l)$$,
  $$SELECT g.id FROM public.get_pipeline_page(p_org_id => '1f0c0001-0000-4000-8000-00000000000a', p_pipeline_id => '1f0c0001-0000-4000-8000-0000000003a1', p_stage_id => 'novo', p_page_size => 1000, p_search => 'Lead 1') g$$,
  'PR2: com busca, visível ⇔ está na coluna buscada');

SELECT set_eq(
  $$SELECT e.id FROM public.pipeline_entries e
     WHERE e.pipeline_id = '1f0c0001-0000-4000-8000-0000000003a1' AND e.stage_key = 'novo'
       AND (SELECT l.visivel_no_recorte FROM public.localizar_negocio_no_funil(e.id, '1f0c0001-0000-4000-8000-00000000000a', p_responsible_id => '1f0c0001-0000-4000-8000-0000000001a2') l)$$,
  $$SELECT g.id FROM public.get_pipeline_page(p_org_id => '1f0c0001-0000-4000-8000-00000000000a', p_pipeline_id => '1f0c0001-0000-4000-8000-0000000003a1', p_stage_id => 'novo', p_page_size => 1000, p_responsible_id => '1f0c0001-0000-4000-8000-0000000001a2') g$$,
  'PR3: com responsável (e co-dono), visível ⇔ está na coluna recortada');

-- (RL) card de outra org não aparece, nem pedindo pela org certa dele
SELECT is(
  (SELECT count(*)::int FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000007b1', '1f0c0001-0000-4000-8000-00000000000a')),
  0, 'RL1: card da org B pedido na org A = nenhuma linha');

-- ===========================================================================
-- Como o Vend 2 ("só os meus" no Funil)
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"1f0c0001-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003eb', '1f0c0001-0000-4000-8000-00000000000a')),
  0, 'RL2: card do Lead 03 (só do Vend 3) não existe para ele — a RLS decide, igual à coluna');

SELECT is(
  (SELECT l.visivel_no_recorte FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f2', '1f0c0001-0000-4000-8000-00000000000a') l),
  true, 'RL3: card do Lead 10 (dele) é achado');

-- Grupo empatado (mesmo instante): dele são 46, 48 e 50; 47 e 49 são do Vend 3
-- e ficam invisíveis — inclusive o 49, entre o card 48 e a próxima visível (50).
SELECT is(
  (SELECT string_agg(right(e.id::text, 3) || '=' || COALESCE((SELECT l.visivel_no_recorte::text FROM public.localizar_negocio_no_funil(e.id, '1f0c0001-0000-4000-8000-00000000000a') l), 'sem-linha'), ',' ORDER BY e.id)
     FROM (VALUES ('1f0c0001-0000-4000-8000-000000000416'::uuid), ('1f0c0001-0000-4000-8000-000000000417'::uuid),
                  ('1f0c0001-0000-4000-8000-000000000418'::uuid), ('1f0c0001-0000-4000-8000-000000000419'::uuid),
                  ('1f0c0001-0000-4000-8000-00000000041a'::uuid)) AS e(id)),
  '416=true,417=sem-linha,418=true,419=sem-linha,41a=true',
  'RL5: no grupo empatado com irmãs invisíveis dos dois lados, ele acha os dele (menor id, do meio e o maior — sentinela) e não acha os alheios');

SELECT set_eq(
  $$SELECT e.id FROM public.pipeline_entries e
     WHERE e.pipeline_id = '1f0c0001-0000-4000-8000-0000000003a1' AND e.stage_key = 'novo'
       AND (SELECT l.visivel_no_recorte FROM public.localizar_negocio_no_funil(e.id, '1f0c0001-0000-4000-8000-00000000000a') l)$$,
  $$SELECT g.id FROM public.get_pipeline_page(p_org_id => '1f0c0001-0000-4000-8000-00000000000a', p_pipeline_id => '1f0c0001-0000-4000-8000-0000000003a1', p_stage_id => 'novo', p_page_size => 1000) g$$,
  'PR4: para o membro restrito, visível ⇔ está na coluna que ELE vê');
-- ===========================================================================
-- Como o admin da org B
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"1f0c0001-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT * FROM public.localizar_negocio_no_funil('1f0c0001-0000-4000-8000-0000000003f2', '1f0c0001-0000-4000-8000-00000000000a')$$,
  'P0001', NULL, 'RL4: usuário de outra org é recusado (access_denied)');

RESET role;

SELECT * FROM finish();
ROLLBACK;
