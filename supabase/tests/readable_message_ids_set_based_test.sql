-- supabase/tests/readable_message_ids_set_based_test.sql
--
-- private.whatsapp_readable_message_instance_ids() set-based (20280123000500)
-- == a composição antiga: ∪ sobre (org ∈ minhas orgs, caixa ∈ readable(org)) de
-- whatsapp_chip_instance_ids(org, caixa) — o corpo de prod até 21/11/2026.
-- Requer a massa de perf da branch. Rodar com scripts/branch-pgtap.mjs.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = 'private.whatsapp_readable_message_instance_ids()'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres}', '(S1) ACL inalterada: postgres + authenticated');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'private.whatsapp_readable_message_instance_ids()'::regprocedure), true, '(S2) DEFINER');
SELECT ok((SELECT position('whatsapp_chip_instance_ids' IN prosrc) = 0 FROM pg_proc WHERE oid = 'private.whatsapp_readable_message_instance_ids()'::regprocedure),
  '(S3) sem chamada por caixa');

CREATE TEMP TABLE _r(persona text, novo uuid[], antigo uuid[]) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated;
CREATE FUNCTION pg_temp.medir(p text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _r SELECT p,
    ARRAY(SELECT unnest(private.whatsapp_readable_message_instance_ids()) ORDER BY 1),
    ARRAY(SELECT DISTINCT h.id
            FROM public.get_my_organization_ids() AS org(id)
            CROSS JOIN LATERAL unnest(public.whatsapp_readable_instance_ids(org.id)) AS box(id)
            CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(org.id, box.id)) AS h(id)
           WHERE auth.uid() IS NOT NULL ORDER BY 1);
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.medir(text) TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"c455535c-9e90-416a-a759-62c446123cfa","role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('admin A (60 caixas)'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"9fd90736-ca2e-4e3a-8d13-217abed8d6ab","role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('membro A (17)'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"1aa02af4-0540-46f1-94ad-7c43eef3e66a","role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('strict JR Tex restrito'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"8af3d7f4-4d68-4390-a2ae-f19c4e0a0896","role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('membro Café'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"cf616708-7fc6-41a9-82e7-36b4cef01f96","role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('balcão Riofix'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"6575eb1d-b036-4ea1-9a69-66606979f94a","role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('master'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true); SET LOCAL ROLE authenticated; SELECT pg_temp.medir('sem usuário'); RESET ROLE;

SELECT is(novo, antigo, '(E) ' || persona || ': conjunto novo == composição antiga') FROM _r ORDER BY persona;
SELECT ok((SELECT cardinality(novo) FROM _r WHERE persona = 'admin A (60 caixas)') > (SELECT cardinality(novo) FROM _r WHERE persona = 'membro A (17)'),
  '(E0) CONTROLE: admin lê mais caixas que o membro');
SELECT ok((SELECT cardinality(novo) FROM _r WHERE persona = 'membro A (17)') >= 17, '(E0b) CONTROLE: membro lê as 17 (+ históricos)');
SELECT is((SELECT novo FROM _r WHERE persona = 'sem usuário'), '{}'::uuid[], '(E0c) sem auth.uid(): vazio');

SELECT * FROM finish();
ROLLBACK;
