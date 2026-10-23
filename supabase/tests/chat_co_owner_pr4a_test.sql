BEGIN;
-- Obrigatório e PRIMEIRA linha depois do BEGIN: ver voip_can_see_call_dono_canonico_test.sql.
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Chamado 793f4b05 · PR4a/5 (migration 20271125000000_co_donos_na_conversa.sql):
-- co-dono (lead_owners, role='co') passa a ser aceito por can_link_or_read_lead,
-- voip_can_see_call e oraculo_chat_scope_allows.
--
-- Fixture: lead pertencente a A (sale_responsible_id). B é co-dono. C é da mesma
-- org, sem vínculo. D é de OUTRA org. Os quatro têm leads.view_all /
-- view_subordinates / view_unassigned DESLIGADAS, senão o default (true) abriria
-- o lead para todos e a asserção não mediria dono nenhum.
--
-- Tudo em session_replication_role = replica: o fixture semeia lead_owners sem
-- passar pelo guarda de org nem pelo trigger de sincronia (o que se mede aqui é
-- a LEITURA). can_link_or_read_lead é REVOGADA de authenticated e service_role,
-- então é chamada como dono do banco com o JWT do caso (auth.uid() lê o claim).
-- Grants provados por has_function_privilege, não por role_table_grants.

SELECT plan(18);

-- ===========================================================================
-- (1) ESTRUTURA E GRANTS — OR REPLACE não pode ter resetado nada
-- ===========================================================================
SELECT ok(
  (SELECT bool_and(prosecdef) FROM pg_proc
    WHERE oid IN ('public.can_link_or_read_lead(uuid,uuid)'::regprocedure,
                  'public.voip_can_see_call(uuid)'::regprocedure,
                  'public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid)'::regprocedure)),
  'as três continuam SECURITY DEFINER');
SELECT ok(
  (SELECT bool_and(proconfig = ARRAY['search_path=public']) FROM pg_proc
    WHERE oid IN ('public.can_link_or_read_lead(uuid,uuid)'::regprocedure,
                  'public.voip_can_see_call(uuid)'::regprocedure,
                  'public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid)'::regprocedure)),
  'search_path das três não mudou');
SELECT ok(
  NOT has_function_privilege('anon', 'public.can_link_or_read_lead(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.can_link_or_read_lead(uuid,uuid)', 'EXECUTE'),
  'can_link_or_read_lead segue sem EXECUTE para anon e authenticated');
SELECT ok(
  NOT has_function_privilege('anon', 'public.voip_can_see_call(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.voip_can_see_call(uuid)', 'EXECUTE'),
  'voip_can_see_call: anon não, authenticated sim');
SELECT ok(
  NOT has_function_privilege('anon', 'public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'oraculo_chat_scope_allows segue sem EXECUTE para anon e authenticated');
SELECT ok(
  (SELECT prosrc LIKE '%rls_lead_co_owned%' FROM pg_proc
    WHERE oid = 'public.can_link_or_read_lead(uuid,uuid)'::regprocedure)
  AND (SELECT prosrc LIKE '%rls_lead_co_owned%' FROM pg_proc
    WHERE oid = 'public.voip_can_see_call(uuid)'::regprocedure),
  'os corpos consomem rls_lead_co_owned');

-- ===========================================================================
-- (2) FIXTURE
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('793f4a00-0000-4000-8000-0000000000a1', 'a@pr4a.test'),
  ('793f4a00-0000-4000-8000-0000000000b1', 'b@pr4a.test'),
  ('793f4a00-0000-4000-8000-0000000000c1', 'c@pr4a.test'),
  ('793f4a00-0000-4000-8000-0000000000d1', 'd@pr4a.test');

INSERT INTO public.organizations (id, name, slug) VALUES
  ('793f4a00-0000-4000-8000-00000000000a', 'Org PR4a A', 'org-pr4a-a'),
  ('793f4a00-0000-4000-8000-00000000000b', 'Org PR4a B', 'org-pr4a-b');

INSERT INTO public.team_members (id, organization_id, user_id, name, email, role, is_active) VALUES
  ('793f4a00-0000-4000-8000-0000000001a1', '793f4a00-0000-4000-8000-00000000000a', '793f4a00-0000-4000-8000-0000000000a1', 'Dono',   'a@pr4a.test', 'member', true),
  ('793f4a00-0000-4000-8000-0000000001b1', '793f4a00-0000-4000-8000-00000000000a', '793f4a00-0000-4000-8000-0000000000b1', 'Co-dono','b@pr4a.test', 'member', true),
  ('793f4a00-0000-4000-8000-0000000001c1', '793f4a00-0000-4000-8000-00000000000a', '793f4a00-0000-4000-8000-0000000000c1', 'Sem vinculo','c@pr4a.test', 'member', true),
  ('793f4a00-0000-4000-8000-0000000001d1', '793f4a00-0000-4000-8000-00000000000b', '793f4a00-0000-4000-8000-0000000000d1', 'Outra org','d@pr4a.test', 'member', true);

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES ('leads.view_all', 'Leads', 'Ver todos os leads', 'fixture', false, true, 0),
       ('leads.view_subordinates', 'Leads', 'Ver leads de subordinados', 'fixture', false, true, 0),
       ('leads.view_unassigned', 'Leads', 'Ver leads sem responsável', 'fixture', false, true, 0)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
SELECT tm.id, tm.organization_id, k, false
FROM public.team_members tm,
     unnest(ARRAY['leads.view_all','leads.view_subordinates','leads.view_unassigned']) AS k
WHERE tm.organization_id IN ('793f4a00-0000-4000-8000-00000000000a', '793f4a00-0000-4000-8000-00000000000b');

INSERT INTO public.leads (id, organization_id, name, phone, sale_responsible_id) VALUES
  ('793f4a00-0000-4000-8000-0000000002a1', '793f4a00-0000-4000-8000-00000000000a',
   'Lead com co-dono', '5548991004001', '793f4a00-0000-4000-8000-0000000001a1');

INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source) VALUES
  ('793f4a00-0000-4000-8000-00000000000a', '793f4a00-0000-4000-8000-0000000002a1',
   '793f4a00-0000-4000-8000-0000000001b1', 'co', false, 'manual');

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, status) VALUES
  ('793f4a00-0000-4000-8000-0000000003a1', '793f4a00-0000-4000-8000-00000000000a', 'inst-pr4a', 'connected');
INSERT INTO public.whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id) VALUES
  ('793f4a00-0000-4000-8000-0000000003a1', '793f4a00-0000-4000-8000-0000000001a1'),
  ('793f4a00-0000-4000-8000-0000000003a1', '793f4a00-0000-4000-8000-0000000001b1'),
  ('793f4a00-0000-4000-8000-0000000003a1', '793f4a00-0000-4000-8000-0000000001c1');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (3) can_link_or_read_lead — auth.uid() vem do claim
-- ===========================================================================
SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000a1","role":"authenticated"}';
SELECT is(public.can_link_or_read_lead('793f4a00-0000-4000-8000-0000000002a1', '793f4a00-0000-4000-8000-00000000000a'),
  true, 'CONTROLE: dono principal lê o lead');

SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(public.can_link_or_read_lead('793f4a00-0000-4000-8000-0000000002a1', '793f4a00-0000-4000-8000-00000000000a'),
  true, 'co-dono lê o lead (o caso da migration)');

SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT is(public.can_link_or_read_lead('793f4a00-0000-4000-8000-0000000002a1', '793f4a00-0000-4000-8000-00000000000a'),
  false, 'membro da mesma org sem vínculo NÃO lê');

SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000d1","role":"authenticated"}';
SELECT is(public.can_link_or_read_lead('793f4a00-0000-4000-8000-0000000002a1', '793f4a00-0000-4000-8000-00000000000a'),
  false, 'membro de OUTRA org NÃO lê');

-- ===========================================================================
-- (4) voip_can_see_call
-- ===========================================================================
SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(public.voip_can_see_call('793f4a00-0000-4000-8000-0000000002a1'), true, 'voip: co-dono vê a ligação do lead');

SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT is(public.voip_can_see_call('793f4a00-0000-4000-8000-0000000002a1'), false, 'voip: sem vínculo NÃO vê');

SET LOCAL request.jwt.claims TO '{"sub":"793f4a00-0000-4000-8000-0000000000d1","role":"authenticated"}';
SELECT is(public.voip_can_see_call('793f4a00-0000-4000-8000-0000000002a1'), false, 'voip: outra org NÃO vê');

SELECT is(public.voip_can_see_call(NULL), true, 'voip: lead_id nulo continua visível');
SELECT is(public.voip_can_see_call('793f4a00-0000-4000-8000-0000000002ff'), false, 'voip: lead inexistente continua fechado');

RESET ROLE;

-- ===========================================================================
-- (5) oraculo_chat_scope_allows (service_role: o membro vem no argumento)
-- ===========================================================================
SELECT is(public.oraculo_chat_scope_allows('793f4a00-0000-4000-8000-00000000000a',
  '793f4a00-0000-4000-8000-0000000001b1', '793f4a00-0000-4000-8000-0000000002a1',
  '793f4a00-0000-4000-8000-0000000003a1'), true, 'oráculo: co-dono com a caixa liberada passa');

SELECT is(public.oraculo_chat_scope_allows('793f4a00-0000-4000-8000-00000000000a',
  '793f4a00-0000-4000-8000-0000000001c1', '793f4a00-0000-4000-8000-0000000002a1',
  '793f4a00-0000-4000-8000-0000000003a1'), false, 'oráculo: sem vínculo (mesmo com a caixa) NÃO passa');

SELECT is(public.oraculo_chat_scope_allows('793f4a00-0000-4000-8000-00000000000b',
  '793f4a00-0000-4000-8000-0000000001b1', '793f4a00-0000-4000-8000-0000000002a1',
  '793f4a00-0000-4000-8000-0000000003a1'), false, 'oráculo: org errada NÃO passa');

SELECT * FROM finish();
ROLLBACK;
