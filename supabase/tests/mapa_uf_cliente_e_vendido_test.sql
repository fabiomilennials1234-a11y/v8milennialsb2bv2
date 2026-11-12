-- mapa_uf_cliente_e_vendido_test.sql
--
-- Mapa de clientes: "Clientes" e "Vendido" pelas fontes canônicas —
-- 20280111000800_mapa_uf_cliente_e_vendido_canonicos.sql.
--
--   Vendido = caderno sale_events, líquido de estorno, de qualquer funil.
--   Cliente = a regra da org na Carteira e na /leads:
--     'cafe'    Café Jurerê + flag leads_cafe_jurere_cadastro_erp = true
--               → cadastro do ERP visível (erp_code AND cafe_jurere_erp_elegivel)
--     'erp'     lei do ERP ligada em toth_connections → leads.classificacao
--     'relacao' demais → leads.relacao_negocios (= relacao_negocios(l))
--
-- Fixtures (4 orgs, gravadas com os gatilhos desligados; relacao_negocios é
-- calculada pela própria função, como os gatilhos fazem em prod):
--   R  (relação)  r1 SC ganho + venda 1000 · r2 SC venda 500 estornada ·
--                 r3 SC card em propostas/vendido com negócio ABERTO e
--                 metadata 9999 · r4 SP etapa won sem negócio · r5 SP venda 250 ·
--                 r6 SC nada · r7 sem UF, venda 400
--   CJ (cafe)     c1 SC código + elegível, venda 700 · c2 SC código oculto ·
--                 c3 SC nativo, venda 300 · c4 SP código em branco ·
--                 c5 SP código + elegível (classificacao 'indefinido')
--   E  (erp)      e1 SC classificacao 'cliente' · e2 SC 'indefinido', ganho + venda 800
--   X  (flag fora da CJ) x1 SC código + elegível · x2 SC venda 100

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(26);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags)
VALUES
  ('4922638c-4909-494e-ba10-12282ec0b161', 'CJ (teste mapa)', 'cj-teste-mapa-cv', 'America/Sao_Paulo', '{"leads_cafe_jurere_cadastro_erp": true}'),
  ('3a0d0001-aaaa-4000-8000-000000000a01', 'Org R (mapa)', 'org-r-mapa-cv', 'America/Sao_Paulo', '{}'),
  ('3a0d0001-eeee-4000-8000-000000000e01', 'Org E (mapa)', 'org-e-mapa-cv', 'America/Sao_Paulo', '{}'),
  ('3a0d0001-bbbb-4000-8000-000000000b01', 'Org X (mapa)', 'org-x-mapa-cv', 'America/Sao_Paulo', '{"leads_cafe_jurere_cadastro_erp": true}')
ON CONFLICT (id) DO UPDATE SET feature_flags = EXCLUDED.feature_flags;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
FROM (VALUES
  ('3a0d0002-0000-4000-8000-0000000000a3'::uuid, 'master-mapa-cv@test.local'),
  ('3a0d0002-0000-4000-8000-0000000000b1'::uuid, 'fora-mapa-cv@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('3a0d0002-0000-4000-8000-0000000000a3', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

-- FORA: membro ativo só da org R.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES ('3a0d0003-0000-4000-8000-0000000000b1', '3a0d0001-aaaa-4000-8000-000000000a01',
        '3a0d0002-0000-4000-8000-0000000000b1', 'Fora', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- Lei do ERP ligada na CJ (como em prod: '0,3') e na org E.
INSERT INTO public.toth_connections (organization_id, user_id, base_url, classificar_leads_por_situacao, clientes_situacoes)
VALUES
  ('4922638c-4909-494e-ba10-12282ec0b161', '3a0d0002-0000-4000-8000-0000000000a3', 'https://erp.test.local', true, '0,3'),
  ('3a0d0001-eeee-4000-8000-000000000e01', '3a0d0002-0000-4000-8000-0000000000a3', 'https://erp.test.local', true, '0')
ON CONFLICT (organization_id) DO UPDATE
  SET classificar_leads_por_situacao = EXCLUDED.classificar_leads_por_situacao,
      clientes_situacoes = EXCLUDED.clientes_situacoes;

-- Org R: o funil de sistema 'propostas' (etapa 'vendido', papel won) e um
-- custom com etapa de papel won.
INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active)
VALUES
  ('3a0d0006-0000-4000-8000-000000000001', '3a0d0001-aaaa-4000-8000-000000000a01', 'Orçamentos', 'propostas', 'system', true),
  ('3a0d0006-0000-4000-8000-000000000002', '3a0d0001-aaaa-4000-8000-000000000a01', 'Funil R', 'funil-r', 'custom', true);

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, stage_role, is_active)
VALUES
  ('3a0d0007-0000-4000-8000-000000000001', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0006-0000-4000-8000-000000000001', 'propostas', 'vendido', 'Vendido', 1, 'won', true),
  ('3a0d0007-0000-4000-8000-000000000002', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0006-0000-4000-8000-000000000002', 'funil-r', 'fechou', 'Fechou', 1, 'won', true);

INSERT INTO public.leads (id, organization_id, name, uf, uf_source, erp_code, cafe_jurere_erp_elegivel, classificacao)
VALUES
  ('3a0d0005-0000-4000-8000-0000000000a1', '3a0d0001-aaaa-4000-8000-000000000a01', 'R1 ganho', 'SC', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000a2', '3a0d0001-aaaa-4000-8000-000000000a01', 'R2 estornada', 'SC', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000a3', '3a0d0001-aaaa-4000-8000-000000000a01', 'R3 aberto em vendido', 'SC', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000a4', '3a0d0001-aaaa-4000-8000-000000000a01', 'R4 etapa won', 'SP', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000a5', '3a0d0001-aaaa-4000-8000-000000000a01', 'R5 venda', 'SP', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000a6', '3a0d0001-aaaa-4000-8000-000000000a01', 'R6 nada', 'SC', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000a7', '3a0d0001-aaaa-4000-8000-000000000a01', 'R7 sem UF', NULL, NULL, NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000c1', '4922638c-4909-494e-ba10-12282ec0b161', 'CJ SC visivel', 'SC', 'erp', 'T001', true, 'cliente'),
  ('3a0d0005-0000-4000-8000-0000000000c2', '4922638c-4909-494e-ba10-12282ec0b161', 'CJ SC oculto', 'SC', 'erp', 'T002', false, 'cliente'),
  ('3a0d0005-0000-4000-8000-0000000000c3', '4922638c-4909-494e-ba10-12282ec0b161', 'CJ SC nativo', 'SC', 'ddd', NULL, false, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000c4', '4922638c-4909-494e-ba10-12282ec0b161', 'CJ SP branco', 'SP', 'ddd', '  ', true, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000c5', '4922638c-4909-494e-ba10-12282ec0b161', 'CJ SP visivel', 'SP', 'erp', 'T005', true, 'indefinido'),
  ('3a0d0005-0000-4000-8000-0000000000e1', '3a0d0001-eeee-4000-8000-000000000e01', 'E1 cadastro cliente', 'SC', 'erp', 'E001', false, 'cliente'),
  ('3a0d0005-0000-4000-8000-0000000000e2', '3a0d0001-eeee-4000-8000-000000000e01', 'E2 indefinido com venda', 'SC', 'erp', 'E002', false, 'indefinido'),
  ('3a0d0005-0000-4000-8000-0000000000f1', '3a0d0001-bbbb-4000-8000-000000000b01', 'X1 codigo', 'SC', 'erp', 'X001', true, 'lead'),
  ('3a0d0005-0000-4000-8000-0000000000f2', '3a0d0001-bbbb-4000-8000-000000000b01', 'X2 venda', 'SC', 'ddd', NULL, false, 'lead');

INSERT INTO public.deals (id, organization_id, title, source, source_lead_id, outcome, won, value)
VALUES
  ('3a0d0008-0000-4000-8000-0000000000a1', '3a0d0001-aaaa-4000-8000-000000000a01', 'Negócio r1', 'human', '3a0d0005-0000-4000-8000-0000000000a1', 'won', true, 1000),
  ('3a0d0008-0000-4000-8000-0000000000a3', '3a0d0001-aaaa-4000-8000-000000000a01', 'Negócio r3', 'human', '3a0d0005-0000-4000-8000-0000000000a3', 'open', false, 9999),
  ('3a0d0008-0000-4000-8000-0000000000e2', '3a0d0001-eeee-4000-8000-000000000e01', 'Negócio e2', 'human', '3a0d0005-0000-4000-8000-0000000000e2', 'won', true, 800);

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, stage_id, stage_key, lead_id, deal_id, metadata)
VALUES
  -- Card parado em propostas/vendido, mas o negócio está ABERTO: a regra
  -- antiga contava cliente e R$ 9.999; o desfecho do negócio diz que não.
  ('3a0d0009-0000-4000-8000-0000000000a3', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0006-0000-4000-8000-000000000001',
   '3a0d0007-0000-4000-8000-000000000001', 'vendido', '3a0d0005-0000-4000-8000-0000000000a3', '3a0d0008-0000-4000-8000-0000000000a3',
   '{"sale_value": 9999}'),
  -- Card sem negócio em etapa de papel won: Relação = cliente.
  ('3a0d0009-0000-4000-8000-0000000000a4', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0006-0000-4000-8000-000000000002',
   '3a0d0007-0000-4000-8000-000000000002', 'fechou', '3a0d0005-0000-4000-8000-0000000000a4', NULL, '{}');

INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, reversed_event_id, sale_value, revenue_stream, producer, deal_id, origin_record_id)
VALUES
  ('3a0d000a-0000-4000-8000-0000000000a1', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0005-0000-4000-8000-0000000000a1', 'sale', NULL, 1000, 'novo_negocio', 'deal', '3a0d0008-0000-4000-8000-0000000000a1', NULL),
  ('3a0d000a-0000-4000-8000-0000000000a2', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0005-0000-4000-8000-0000000000a2', 'sale', NULL, 500, 'novo_negocio', 'carteira', NULL, gen_random_uuid()),
  ('3a0d000a-0000-4000-8000-0000000000b2', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0005-0000-4000-8000-0000000000a2', 'sale_reversed', '3a0d000a-0000-4000-8000-0000000000a2', 500, 'novo_negocio', 'carteira', NULL, gen_random_uuid()),
  ('3a0d000a-0000-4000-8000-0000000000a5', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0005-0000-4000-8000-0000000000a5', 'sale', NULL, 250, 'novo_negocio', 'carteira', NULL, gen_random_uuid()),
  ('3a0d000a-0000-4000-8000-0000000000a7', '3a0d0001-aaaa-4000-8000-000000000a01', '3a0d0005-0000-4000-8000-0000000000a7', 'sale', NULL, 400, 'novo_negocio', 'carteira', NULL, gen_random_uuid()),
  ('3a0d000a-0000-4000-8000-0000000000c1', '4922638c-4909-494e-ba10-12282ec0b161', '3a0d0005-0000-4000-8000-0000000000c1', 'sale', NULL, 700, 'carteira', 'carteira', NULL, gen_random_uuid()),
  ('3a0d000a-0000-4000-8000-0000000000c3', '4922638c-4909-494e-ba10-12282ec0b161', '3a0d0005-0000-4000-8000-0000000000c3', 'sale', NULL, 300, 'novo_negocio', 'carteira', NULL, gen_random_uuid()),
  ('3a0d000a-0000-4000-8000-0000000000e2', '3a0d0001-eeee-4000-8000-000000000e01', '3a0d0005-0000-4000-8000-0000000000e2', 'sale', NULL, 800, 'novo_negocio', 'deal', '3a0d0008-0000-4000-8000-0000000000e2', NULL),
  ('3a0d000a-0000-4000-8000-0000000000f2', '3a0d0001-bbbb-4000-8000-000000000b01', '3a0d0005-0000-4000-8000-0000000000f2', 'sale', NULL, 100, 'novo_negocio', 'carteira', NULL, gen_random_uuid());

-- A projeção relacao_negocios, como os gatilhos a mantêm em prod.
UPDATE public.leads l SET relacao_negocios = public.relacao_negocios(l)
 WHERE l.organization_id IN ('4922638c-4909-494e-ba10-12282ec0b161', '3a0d0001-aaaa-4000-8000-000000000a01',
                             '3a0d0001-eeee-4000-8000-000000000e01', '3a0d0001-bbbb-4000-8000-000000000b01');

-- O que a Carteira e a /leads diriam de cada lead, pela função canônica.
CREATE TEMP TABLE esperado AS
SELECT l.id, l.organization_id,
       public.relacao_negocios(l) = 'cliente' AS relacao,
       public.visivel_lista_cafe_jurere(l) AND public.classificacao_cafe_jurere(l) = 'cliente' AS cafe
  FROM public.leads l
 WHERE l.organization_id IN ('4922638c-4909-494e-ba10-12282ec0b161', '3a0d0001-aaaa-4000-8000-000000000a01');
GRANT SELECT ON esperado TO PUBLIC;

-- O caderno líquido da org R (o que o card de receita somaria sem período).
CREATE TEMP TABLE caderno AS
SELECT s.organization_id, round(sum(s.sale_value))::bigint AS liquido
  FROM public.sale_events s
 WHERE s.event_type = 'sale'
   AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
 GROUP BY s.organization_id;
GRANT SELECT ON caderno TO PUBLIC;

SET LOCAL session_replication_role = origin;

-- Resumo estável do mapa: "SC:4/1/1000,SP:2/2/250|sem:1" (leads/clientes/vendido).
CREATE OR REPLACE FUNCTION pg_temp.resumo(p_org uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(trim(uf) || ':' || leads_count || '/' || clients_count || '/' || round(total_sold)::bigint, ',' ORDER BY uf), '(vazio)')
         || '|sem:' || coalesce(max(unmapped_count)::text, '-')
  FROM public.get_uf_heatmap(p_org)
$$;

-- Clientes do relatório de um estado, por nome.
CREATE OR REPLACE FUNCTION pg_temp.clientes(p_uf text, p_org uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(name, ',' ORDER BY name), '(nenhum)')
  FROM public.get_leads_by_uf(p_uf::char(2), 60, p_org) WHERE is_client
$$;

-- ── Contrato ──────────────────────────────────────────────────────────────
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_uf_heatmap(uuid)'::regprocedure)
      AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_leads_by_uf(character,integer,uuid)'::regprocedure),
  'C1: as duas continuam SECURITY DEFINER');
SELECT ok(position('PERFORM public.assert_org_access(v_org_id);' IN pg_get_functiondef('public.get_uf_heatmap(uuid)'::regprocedure)) > 0
      AND position('PERFORM public.assert_org_access(v_org_id);' IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) > 0,
  'C2: a regra de acesso da 20280111000500 continua');
SELECT is((SELECT count(*)::int FROM regexp_matches(pg_get_functiondef('public.get_uf_heatmap(uuid)'::regprocedure), 'v_regra := CASE', 'g'))
        + (SELECT count(*)::int FROM regexp_matches(pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure), 'v_regra := CASE', 'g')), 2,
  'C3: uma troca por função, mesmo aplicando a migration de novo (idempotente)');
SELECT ok(position('negocio_projetado' IN pg_get_functiondef('public.get_uf_heatmap(uuid)'::regprocedure)) = 0
      AND position('negocio_projetado' IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) = 0
      -- O caderno pelo esquema do ambiente, como a receita canônica: a view
      -- private do regime estrito onde ela existe, public onde não.
      AND position(format('FROM %s.sale_events s', CASE WHEN to_regclass('private.sale_events') IS NOT NULL THEN 'private' ELSE 'public' END)
                   IN pg_get_functiondef('public.get_uf_heatmap(uuid)'::regprocedure)) > 0
      AND position(format('FROM %s.sale_events s', CASE WHEN to_regclass('private.sale_events') IS NOT NULL THEN 'private' ELSE 'public' END)
                   IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) > 0,
  'C4: nenhuma leitura do funil propostas; o vendido vem do caderno');
SELECT is((SELECT string_agg(l.name || ':' || l.relacao_negocios, ',' ORDER BY l.name) FROM public.leads l
            WHERE l.organization_id = '3a0d0001-aaaa-4000-8000-000000000a01'),
  'R1 ganho:cliente,R2 estornada:lead,R3 aberto em vendido:lead,R4 etapa won:cliente,R5 venda:cliente,R6 nada:lead,R7 sem UF:cliente',
  'F1: a Lei da Relação das fixtures (ganho, etapa won ou venda líquida; estorno e card aberto não)');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"3a0d0002-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

-- ── Org R: Lei da Relação + caderno ───────────────────────────────────────
SELECT is(pg_temp.resumo('3a0d0001-aaaa-4000-8000-000000000a01'), 'SC:4/1/1000,SP:2/2/250|sem:1',
  'R1: SC tem 1 cliente e R$ 1.000 (o estorno e o card aberto em vendido não contam); SP 2 clientes e R$ 250');
SELECT is(pg_temp.clientes('SC', '3a0d0001-aaaa-4000-8000-000000000a01'), 'R1 ganho',
  'R2: no relatório de SC, só o negócio ganho é Cliente');
SELECT is((SELECT is_client::text || '/' || round(sold_value)::bigint FROM public.get_leads_by_uf('SC', 60, '3a0d0001-aaaa-4000-8000-000000000a01')
            WHERE name = 'R3 aberto em vendido'), 'false/0',
  'R3: card em propostas/vendido com negócio aberto não é cliente nem R$ 9.999 (a regra antiga contava)');
SELECT is((SELECT g.name FROM public.get_leads_by_uf('SC', 60, '3a0d0001-aaaa-4000-8000-000000000a01')
             WITH ORDINALITY AS g(id, name, company, phone, uf_source, is_client, sold_value, created_at, ord)
            ORDER BY g.ord LIMIT 1), 'R1 ganho',
  'R4: o relatório abre por quem mais comprou');
SELECT is(pg_temp.clientes('SP', '3a0d0001-aaaa-4000-8000-000000000a01'), 'R4 etapa won,R5 venda',
  'R5: em SP, etapa de papel won sem negócio e venda sem negócio são clientes');
SELECT is((SELECT 'linhas:' || count(*) || '|divergentes:' || count(*) FILTER (WHERE g.is_client IS DISTINCT FROM e.relacao)
             FROM (SELECT * FROM public.get_leads_by_uf('SC', 60, '3a0d0001-aaaa-4000-8000-000000000a01')
                   UNION ALL
                   SELECT * FROM public.get_leads_by_uf('SP', 60, '3a0d0001-aaaa-4000-8000-000000000a01')) g
             JOIN esperado e ON e.id = g.id), 'linhas:6|divergentes:0',
  'R6: paridade com relacao_negocios(l), a regra da /leads, em todo lead com UF');
SELECT is((SELECT 'mapa:' || sum(round(total_sold))::bigint FROM public.get_uf_heatmap('3a0d0001-aaaa-4000-8000-000000000a01'))
          || '|caderno:' || (SELECT liquido FROM caderno WHERE organization_id = '3a0d0001-aaaa-4000-8000-000000000a01'),
  'mapa:1250|caderno:1650',
  'R7: o Vendido do mapa é o caderno líquido dos leads com UF (R$ 400 do lead sem UF ficam fora)');

-- ── Café Jurerê com a flag: cadastro do ERP visível ───────────────────────
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '4922638c-4909-494e-ba10-12282ec0b161'))
        + (SELECT count(*)::int FROM public.get_leads_by_uf('SP', 60, '4922638c-4909-494e-ba10-12282ec0b161')), 5,
  'CJ0: a CJ da preview só tem os leads do teste');
SELECT is(pg_temp.resumo('4922638c-4909-494e-ba10-12282ec0b161'), 'SC:3/1/1000,SP:2/1/0|sem:0',
  'CJ1: SC tem 1 cliente (o cadastro visível) e R$ 1.000 vendidos; SP 1 cliente (código em branco não conta)');
SELECT is(pg_temp.clientes('SC', '4922638c-4909-494e-ba10-12282ec0b161'), 'CJ SC visivel',
  'CJ2: oculto e nativo seguem como Lead no relatório de SC');
SELECT is((SELECT string_agg(g.name, ',' ORDER BY g.ord) FROM public.get_leads_by_uf('SC', 60, '4922638c-4909-494e-ba10-12282ec0b161')
             WITH ORDINALITY AS g(id, name, company, phone, uf_source, is_client, sold_value, created_at, ord)),
  'CJ SC visivel,CJ SC nativo,CJ SC oculto',
  'CJ3: ordem do relatório = quem mais comprou primeiro');
SELECT is((SELECT is_client::text || '/' || round(sold_value)::bigint FROM public.get_leads_by_uf('SC', 60, '4922638c-4909-494e-ba10-12282ec0b161')
            WHERE name = 'CJ SC nativo'), 'false/300',
  'CJ4: o nativo que comprou soma no Vendido, mas não é cliente pela regra da CJ');
SELECT is((SELECT 'linhas:' || count(*) || '|divergentes:' || count(*) FILTER (WHERE g.is_client IS DISTINCT FROM e.cafe)
             FROM (SELECT * FROM public.get_leads_by_uf('SC', 60, '4922638c-4909-494e-ba10-12282ec0b161')
                   UNION ALL
                   SELECT * FROM public.get_leads_by_uf('SP', 60, '4922638c-4909-494e-ba10-12282ec0b161')) g
             JOIN esperado e ON e.id = g.id), 'linhas:5|divergentes:0',
  'CJ5: paridade com a Carteira (visivel_lista_cafe_jurere AND classificacao_cafe_jurere = cliente)');
SELECT is(pg_temp.clientes('SP', '4922638c-4909-494e-ba10-12282ec0b161'), 'CJ SP visivel',
  'CJ6: em SP, o cadastro visível é cliente mesmo com classificacao indefinido');

-- ── Lei do ERP e flag fora da CJ ──────────────────────────────────────────
SELECT is(pg_temp.resumo('3a0d0001-eeee-4000-8000-000000000e01'), 'SC:2/1/800|sem:0',
  'E1: lei do ERP ligada: cliente = classificacao; a venda do indefinido entra no Vendido');
SELECT is(pg_temp.resumo('3a0d0001-bbbb-4000-8000-000000000b01'), 'SC:2/1/100|sem:0',
  'X1: a flag fora da CJ não liga a regra cafe (como usaClassificacaoCafeJurere): vale a Relação');

-- ── A flag da CJ desliga e liga como no front ─────────────────────────────
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
UPDATE public.organizations SET feature_flags = '{"leads_cafe_jurere_cadastro_erp": "true"}' WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SELECT is(pg_temp.resumo('4922638c-4909-494e-ba10-12282ec0b161'), 'SC:3/2/1000,SP:2/0/0|sem:0',
  'FL1: flag como texto "true" não liga (=== true no front): a CJ cai na lei do ERP');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
UPDATE public.organizations SET feature_flags = '{"leads_cafe_jurere_cadastro_erp": false}' WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SELECT is(pg_temp.clientes('SC', '4922638c-4909-494e-ba10-12282ec0b161'), 'CJ SC oculto,CJ SC visivel',
  'FL2: flag desligada: vale a lei do ERP (classificacao), como na /leads');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
UPDATE public.toth_connections SET classificar_leads_por_situacao = false WHERE organization_id = '4922638c-4909-494e-ba10-12282ec0b161';
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SELECT is(pg_temp.clientes('SC', '4922638c-4909-494e-ba10-12282ec0b161'), 'CJ SC nativo,CJ SC visivel',
  'FL3: sem flag e sem lei do ERP: vale a Relação (quem comprou)');

-- ── Acesso (20280111000500) intacto ───────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"3a0d0002-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok($$ SELECT * FROM public.get_uf_heatmap('4922638c-4909-494e-ba10-12282ec0b161') $$, 'P0001', 'access_denied',
  'A1: quem não é da org segue barrado no mapa');
SELECT throws_ok($$ SELECT * FROM public.get_leads_by_uf('SC', 60, '4922638c-4909-494e-ba10-12282ec0b161') $$, 'P0001', 'access_denied',
  'A2: e no relatório do estado');

SELECT * FROM finish();
ROLLBACK;
