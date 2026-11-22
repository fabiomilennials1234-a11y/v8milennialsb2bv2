-- supabase/tests/lista_oficial_gates_test.sql
--
-- get_official_whatsapp_conversation_list_multi (20280123000700): gates
-- constantes fora do laço, MESMA saída que a versão anterior (perf_old, de
-- _perf_old_snapshot.sql), por persona — inclusive quem NÃO tem atalho
-- (membro sem leads.view_all numa org com chat_restrict_to_owner, onde o gate
-- por linha continua decidindo). Requer a massa de perf da branch.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);

SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_official_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid,text)'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres}', '(S1) ACL: só authenticated');
SELECT is((SELECT (length(prosrc) - length(replace(prosrc, 'private.', ''))) / 8 FROM pg_proc
            WHERE oid = 'public.get_official_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid,text)'::regprocedure),
  CASE WHEN to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN 7 ELSE 12 END, '(S2) contagem de private. (12 na forma de prod)');

-- Mais vínculo por telefone: metade dos contatos ganha lead com o MESMO
-- telefone em outra org (não pode vazar nome) — e um membro sem view_all.
CREATE TEMP TABLE _o(caso text, novo text, antigo text, n int, com_lead int) ON COMMIT DROP;
GRANT ALL ON _o TO authenticated;
CREATE FUNCTION pg_temp.medir(p_caso text, p_org uuid, p_box uuid) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _o SELECT p_caso,
    (SELECT md5(string_agg(x::text, '|' ORDER BY x.ordinality)) FROM public.get_official_whatsapp_conversation_list_multi(p_org => p_org, p_instances => ARRAY[p_box], p_limit => 200) WITH ORDINALITY x),
    (SELECT md5(string_agg(y::text, '|' ORDER BY y.ordinality)) FROM perf_old.get_official_whatsapp_conversation_list_multi(p_org => p_org, p_instances => ARRAY[p_box], p_limit => 200) WITH ORDINALITY y),
    (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(p_org => p_org, p_instances => ARRAY[p_box], p_limit => 200)),
    (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(p_org => p_org, p_instances => ARRAY[p_box], p_limit => 200) z WHERE z.lead_name IS NOT NULL);
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.medir(text, uuid, uuid) TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"46c1b874-7492-4378-b609-fbb309ba1e87","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('admin 38f3 (atalho ligado)', '38f3bea4-44c6-4732-bb20-065f547a7ed8', '7312692e-b9b4-4f90-aba3-09cff992bbfc'); RESET ROLE;

-- Membro da 38f3 SEM leads.view_all, com chat_restrict_to_owner LIGADO: nenhum
-- dos dois atalhos pode ligar; o gate por linha decide (e o resultado é o de antes).
SET LOCAL session_replication_role = replica;
UPDATE public.organizations SET chat_restrict_to_owner = true WHERE id = '38f3bea4-44c6-4732-bb20-065f547a7ed8';
UPDATE public.whatsapp_instances SET status = status WHERE id = '7312692e-b9b4-4f90-aba3-09cff992bbfc';
INSERT INTO public.whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id)
SELECT '7312692e-b9b4-4f90-aba3-09cff992bbfc', tm.id FROM public.team_members tm
 WHERE tm.organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8' AND tm.role = 'member' AND tm.is_active
   AND NOT EXISTS (SELECT 1 FROM public.whatsapp_instance_allowed_members a WHERE a.whatsapp_instance_id = '7312692e-b9b4-4f90-aba3-09cff992bbfc' AND a.team_member_id = tm.id);
DELETE FROM public.member_feature_permissions WHERE organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8' AND feature_key = 'leads.view_all';
SET LOCAL session_replication_role = origin;
-- Membro comum sintético (a 38f3 da massa só tem admins), com acesso à caixa.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('0f0f0f0f-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membro.oficial@exemplo.test', now(), now());
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_members (id, organization_id, user_id, name, email, role, is_active)
VALUES ('0f0f0f0f-0000-4000-8000-0000000000d1', '38f3bea4-44c6-4732-bb20-065f547a7ed8', '0f0f0f0f-0000-4000-8000-0000000000c1', 'Membro Oficial', 'membro.oficial@exemplo.test', 'member', true);
INSERT INTO public.whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id)
VALUES ('7312692e-b9b4-4f90-aba3-09cff992bbfc', '0f0f0f0f-0000-4000-8000-0000000000d1');
-- metade dos leads da org passa a ser do membro: o gate por linha tem o que decidir
UPDATE public.leads SET pre_sale_responsible_id = '0f0f0f0f-0000-4000-8000-0000000000d1'
 WHERE organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8' AND abs(hashtext(id::text)) % 2 = 0;
SET LOCAL session_replication_role = origin;
CREATE TEMP TABLE _membro ON COMMIT DROP AS SELECT '0f0f0f0f-0000-4000-8000-0000000000c1'::uuid AS user_id;
SELECT ok((SELECT count(*) FROM _membro) = 1, '(E0a) CONTROLE: há membro comum na 38f3');
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM _membro), 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro 38f3 sem view_all, org restrita (gate por linha)', '38f3bea4-44c6-4732-bb20-065f547a7ed8', '7312692e-b9b4-4f90-aba3-09cff992bbfc');
CREATE TEMP TABLE _alheias ON COMMIT DROP AS
SELECT count(*)::int AS n FROM public.get_official_whatsapp_conversation_list_multi(p_org => '38f3bea4-44c6-4732-bb20-065f547a7ed8', p_instances => ARRAY['7312692e-b9b4-4f90-aba3-09cff992bbfc']::uuid[], p_limit => 200) x
 WHERE x.lead_id IS NOT NULL AND x.lead_id NOT IN (SELECT l.id FROM public.leads l WHERE l.pre_sale_responsible_id = '0f0f0f0f-0000-4000-8000-0000000000d1');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"6575eb1d-b036-4ea1-9a69-66606979f94a","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('master', '38f3bea4-44c6-4732-bb20-065f547a7ed8', '7312692e-b9b4-4f90-aba3-09cff992bbfc'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"0e0e0e0e-0000-4000-8000-0000000000a1","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_official_whatsapp_conversation_list_multi(p_org => '38f3bea4-44c6-4732-bb20-065f547a7ed8', p_limit => 10)$$, '42501', NULL, '(X1) outra org: 42501');
RESET ROLE;

SELECT is(novo, antigo, '(E) ' || caso || ': saída idêntica (' || n || ' linhas, ' || com_lead || ' com nome de lead)') FROM _o ORDER BY caso;
SELECT ok((SELECT n FROM _o WHERE caso = 'admin 38f3 (atalho ligado)') = 200, '(E0) CONTROLE: admin enche a página (200)');
SELECT ok((SELECT com_lead FROM _o WHERE caso = 'admin 38f3 (atalho ligado)') > 0, '(E0b) CONTROLE: vínculo com lead aparece');
SELECT is((SELECT n FROM _alheias), 0, '(E0c) CONTROLE: com a org restrita o membro só vê conversa de lead dele (gate por linha ativo)');

SELECT * FROM finish();
ROLLBACK;
