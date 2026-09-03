BEGIN;
-- Obrigatório, e tem que ser a PRIMEIRA linha depois do BEGIN. pgTAP não é
-- criado por migration nenhuma nem pelo config.toml, e como toda suíte roda
-- dentro de BEGIN/ROLLBACK ele nunca fica instalado entre arquivos.
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova 20270915000000_voip_can_see_call_por_dono_canonico.sql: a fronteira do
-- lead na leitura de `voip_calls` olha o DONO CANÔNICO.
--
-- O CASO QUE MANDA: membro é `sale_responsible_id` do lead e `closer_id` é NULO.
-- É a divergência medida em produção em 2026-09-02 (26 leads): o produto
-- atribui pelas canônicas, as legadas são espelho por trigger
-- (`fn_sync_canonical_assignment`) e o espelho não é fiel. Com a função antiga
-- — `can_see_lead_by_permissions(sdr_id, closer_id)` — o dono de verdade NÃO
-- lia a própria ligação.
--
-- O fixture roda em `session_replication_role = replica` de propósito: é o que
-- impede a trigger de sincronizar as legadas a partir das canônicas, e portanto
-- é o que permite SEMEAR a divergência. Sem isso a trigger preencheria
-- `closer_id` e o teste ficaria verde pelo motivo errado.
--
-- `leads.view_all`, `leads.view_unassigned` e `leads.view_subordinates` são
-- desligadas para os DOIS membros, senão `view_all` (default true) abriria o
-- lead para todo mundo e a asserção não mediria dono nenhum.
--
-- Tudo como `authenticated`: `postgres` bypassa RLS e produziria falso verde.

SELECT plan(12);

-- ===========================================================================
-- (1) ESTRUTURA E GRANTS — OR REPLACE não pode ter resetado nada
-- ===========================================================================

SELECT ok(
  to_regprocedure('public.voip_can_see_call(uuid)') IS NOT NULL,
  'voip_can_see_call existe');

SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.voip_can_see_call(uuid)'::regprocedure),
  'continua SECURITY DEFINER — é o que a impede de recursar na RLS de leads');

SELECT ok(
  (SELECT prosrc LIKE '%pre_sale_responsible_id%' AND prosrc LIKE '%sale_responsible_id%'
     FROM pg_proc WHERE oid = 'public.voip_can_see_call(uuid)'::regprocedure),
  'o corpo lê as colunas CANÔNICAS de responsável');

SELECT ok(
  (SELECT prosrc NOT LIKE '%sdr_id%' AND prosrc NOT LIKE '%closer_id%'
     FROM pg_proc WHERE oid = 'public.voip_can_see_call(uuid)'::regprocedure),
  'o corpo NÃO lê mais sdr_id/closer_id — legadas, marcadas para drop (#755)');

-- DROP+CREATE devolveria EXECUTE a PUBLIC/anon pelo pg_default_acl. A migration
-- usa OR REPLACE; isto é o que prova que ela usou.
SELECT ok(
  NOT has_function_privilege('anon', 'public.voip_can_see_call(uuid)', 'EXECUTE'),
  'anon NÃO executa voip_can_see_call');
SELECT ok(
  has_function_privilege('authenticated', 'public.voip_can_see_call(uuid)', 'EXECUTE'),
  'authenticated executa voip_can_see_call — a policy de voip_calls depende disto');

-- ===========================================================================
-- (2) FIXTURE — a divergência canônico ≠ legado, semeada com as triggers OFF
-- ===========================================================================

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('e0000001-0000-0000-0000-000000000001', 'dono-canonico@voip.test'),
  ('e0000001-0000-0000-0000-000000000002', 'colega-canonico@voip.test');

INSERT INTO public.organizations (id, name, slug) VALUES
  ('e1111111-1111-1111-1111-111111111111', 'Org Dono Canonico', 'org-dono-canonico');

INSERT INTO public.team_members (id, organization_id, user_id, name, email, role, is_active) VALUES
  ('e2222222-2222-2222-2222-222222222221', 'e1111111-1111-1111-1111-111111111111',
   'e0000001-0000-0000-0000-000000000001', 'Dono Canonico', 'dono-canonico@voip.test', 'member', true),
  ('e2222222-2222-2222-2222-222222222222', 'e1111111-1111-1111-1111-111111111111',
   'e0000001-0000-0000-0000-000000000002', 'Colega', 'colega-canonico@voip.test', 'member', true);

-- O catálogo é pré-condição de `has_feature_permission`: sem a linha a função
-- devolve false por NOT FOUND e o teste mediria ausência de seed, não fronteira.
INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES ('leads.view_all', 'Leads', 'Ver todos os leads', 'fixture', false, true, 0),
       ('leads.view_subordinates', 'Leads', 'Ver leads de subordinados', 'fixture', false, true, 0),
       ('leads.view_unassigned', 'Leads', 'Ver leads sem responsável', 'fixture', false, true, 0)
ON CONFLICT (key) DO NOTHING;

-- Os DOIS restringidos: o que sobra para decidir é SÓ a responsabilidade.
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
SELECT tm, 'e1111111-1111-1111-1111-111111111111', k, false
FROM unnest(ARRAY['e2222222-2222-2222-2222-222222222221'::uuid,
                  'e2222222-2222-2222-2222-222222222222'::uuid]) AS tm,
     unnest(ARRAY['leads.view_all','leads.view_subordinates','leads.view_unassigned']) AS k;

-- A DIVERGÊNCIA: dono canônico preenchido, legadas NULAS. Só nasce assim com
-- as triggers desligadas — em produção é o que a sincronização deixou passar.
INSERT INTO public.leads
  (id, organization_id, name, phone, sale_responsible_id, pre_sale_responsible_id)
VALUES ('e4444444-4444-4444-4444-444444444441', 'e1111111-1111-1111-1111-111111111111',
        'Lead do Dono Canonico', '5548991005289',
        'e2222222-2222-2222-2222-222222222221', NULL);

SELECT ok(
  (SELECT sdr_id IS NULL AND closer_id IS NULL AND responsible_id IS NULL
     FROM public.leads WHERE id = 'e4444444-4444-4444-4444-444444444441'),
  'CONTROLE: as legadas ficaram nulas — a divergência foi semeada de verdade');

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, status, voice_calls_enabled)
VALUES ('e3333333-3333-3333-3333-333333333331', 'e1111111-1111-1111-1111-111111111111',
        'inst-dono-canonico', 'connected', true);

INSERT INTO public.voip_sessions (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('e1111111-1111-1111-1111-111111111111', 'e3333333-3333-3333-3333-333333333331',
        'sess-dono-canonico', 'dono canonico', 'open');

-- A ligação para o lead, escrita direto: quem está em julgamento é a LEITURA.
-- A reserva (`fn_voip_call_reserve`) tem suíte própria.
INSERT INTO public.voip_calls
  (organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id, peer_phone, direction, status)
VALUES ('e1111111-1111-1111-1111-111111111111', 'sess-dono-canonico', 'E0000000000000000000000000000001',
        'e4444444-4444-4444-4444-444444444441', 'e0000001-0000-0000-0000-000000000001',
        '5548991005289', 'outbound', 'ended');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (3) QUEM VÊ — como `authenticated`
-- ===========================================================================

SET LOCAL ROLE authenticated;

-- O DONO CANÔNICO, com `closer_id` nulo. Era o caso que a função antiga negava.
SET LOCAL request.jwt.claims TO '{"sub":"e0000001-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  public.voip_can_see_call('e4444444-4444-4444-4444-444444444441'),
  true,
  'membro que é sale_responsible_id (closer_id NULO) VÊ a ligação — o caso da migration');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-dono-canonico'),
  1,
  'e a policy de voip_calls entrega a linha a ele');

-- O COLEGA: mesma org, sem responsabilidade, sem view_all. Não vê. Se este
-- ficasse verde junto com o de cima, a asserção de cima não teria medido dono.
SET LOCAL request.jwt.claims TO '{"sub":"e0000001-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-dono-canonico'),
  0,
  'colega sem responsabilidade e sem leads.view_all NÃO vê a ligação');

-- As duas cláusulas que a migration preserva, exercidas por quem não vê o lead.
SELECT is(
  public.voip_can_see_call(NULL),
  true,
  'lead_id nulo continua visível — número desconhecido ligando é fato da org (ADR-0027)');

SELECT is(
  public.voip_can_see_call('e4444444-4444-4444-4444-444444444499'),
  false,
  'lead inexistente continua fechado — o COALESCE(…, false) ficou');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
