-- supabase/tests/manifest_definer_isolamento_test.sql
--
-- whatsapp_thread_manifest SECURITY DEFINER (20280123000800) == o MESMO SELECT
-- sob a RLS de whatsapp_messages como `authenticated` (o corpo SQL INVOKER de
-- prod até 21/11/2026, md5 23437789…), por persona, em várias conversas.
--
-- Requer a massa de perf da branch (ids de prod, textos sintéticos). Rodar:
--   node scripts/branch-pgtap.mjs --ref <branch> --file supabase/tests/manifest_definer_isolamento_test.sql
--
-- Asserts
--   (S) DEFINER, search_path vazio, ACL só authenticated; fingerprint de policies
--       é um dos dois revisados (TRIPWIRE: policy nova em whatsapp_messages sem
--       revisar a função reprova aqui e a função recusa em runtime)
--   (E) por persona — admin, membro com 17 de 60 caixas, strict JR Tex
--       (restrito), JR Tex com escopo (Karine), JR Tex restrito, membro strict do
--       Café, balcão Riofix (com conversa plantada no funil do balcão), master — o manifest novo é IGUAL ao oráculo sob RLS
--       em todas as conversas amostradas (inclusive caixas que a persona NÃO lê)
--   (X) outra org → 42501; caixa não legível → manifest vazio
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(28);

SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.whatsapp_thread_manifest(uuid,uuid[],text,timestamp with time zone,uuid,text)'::regprocedure),
  true, '(S1) SECURITY DEFINER');
SELECT ok((SELECT 'search_path=""' = ANY(proconfig) FROM pg_proc WHERE oid = 'public.whatsapp_thread_manifest(uuid,uuid[],text,timestamp with time zone,uuid,text)'::regprocedure),
  '(S2) search_path vazio');
SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = 'public.whatsapp_thread_manifest(uuid,uuid[],text,timestamp with time zone,uuid,text)'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres}', '(S3) ACL: só authenticated');
SELECT ok(private.whatsapp_messages_policy_fingerprint() IN ('aa9b3228f5e4c80130235ca1b286c8b1', '7e5c0bc4e85ec7c8cfd93bb97ae5425b'),
  '(S4) TRIPWIRE: policies de leitura de whatsapp_messages são as revisadas');
SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = 'private.whatsapp_messages_policy_fingerprint()'::regprocedure),
  '{postgres=X/postgres}', '(S5) fingerprint: só o owner executa');

-- Oráculo: o corpo INVOKER de prod, literal, avaliado sob a RLS do chamador.
CREATE FUNCTION pg_temp.manifest_rls(p_organization_id uuid, p_instance_ids uuid[], p_phone text,
  p_since_timestamp timestamptz DEFAULT NULL, p_since_id uuid DEFAULT NULL, p_fingerprint text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  WITH visible AS (
    SELECT m.id, m.xmin::text AS revision, m.timestamp
    FROM public.whatsapp_messages m
    WHERE m.organization_id = p_organization_id
      AND m.instance_id = ANY(p_instance_ids)
      AND m.normalized_phone = p_phone
      AND (p_since_timestamp IS NULL OR (m.timestamp, m.id) >= (p_since_timestamp, p_since_id))
    ORDER BY m.timestamp DESC, m.id DESC
    LIMIT CASE WHEN p_since_timestamp IS NULL THEN 100 ELSE NULL END
  ), snapshot AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revision', revision)
      ORDER BY timestamp, id), '[]'::jsonb) AS manifest,
      md5(COALESCE(string_agg(id::text || ':' || revision, ',' ORDER BY timestamp, id), '')) AS fingerprint
    FROM visible
  ) SELECT jsonb_build_object('fingerprint', fingerprint,
    'unchanged', fingerprint IS NOT DISTINCT FROM p_fingerprint,
    'manifest', CASE WHEN fingerprint IS NOT DISTINCT FROM p_fingerprint THEN NULL ELSE manifest END)
  FROM snapshot;
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.manifest_rls(uuid, uuid[], text, timestamptz, uuid, text) TO authenticated;

-- Amostra por org: as 12 conversas mais recentes de cada caixa-alvo + a mais
-- pesada; cada conversa é pedida com a SUA caixa e com TODAS as caixas da org.
CREATE TEMP TABLE _amostra ON COMMIT DROP AS
SELECT s.organization_id org, s.instance_id box, s.normalized_phone phone
  FROM (SELECT s.*, row_number() OVER (PARTITION BY s.organization_id ORDER BY s.last_message_time DESC) rn
          FROM public.whatsapp_conversation_summary s) s
 WHERE s.rn <= 12
UNION
SELECT m.organization_id, m.instance_id, m.normalized_phone
  FROM (SELECT organization_id, instance_id, normalized_phone, count(*) c FROM public.whatsapp_messages
         GROUP BY 1, 2, 3 ORDER BY c DESC LIMIT 1) m;
-- Caso plantado (desfeito pelo ROLLBACK): número compartilhado na JR Tex (a
-- org com strict_lead_owner_access). Numa conversa que o membro strict VÊ, a
-- mensagem mais antiga passa a apontar (lead_id) para um lead que ele NÃO vê.
-- A permissiva olha o telefone (can_see_chat) e deixa passar; a restritiva
-- strict_owner_related_select olha o lead_id POR LINHA e esconde. O DEFINER
-- tem de esconder a mesma.
CREATE TEMP TABLE _vis(id uuid, instance_id uuid, phone text, ts timestamptz) ON COMMIT DROP;
CREATE TEMP TABLE _leads_vis(id uuid) ON COMMIT DROP;
GRANT ALL ON _vis, _leads_vis TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1aa02af4-0540-46f1-94ad-7c43eef3e66a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO _vis SELECT m.id, m.instance_id, m.normalized_phone, m."timestamp" FROM public.whatsapp_messages m
 WHERE m.organization_id = '30bb5c27-88f4-4f91-9493-835405ae2e11' AND m.lead_id IS NOT NULL;
INSERT INTO _leads_vis SELECT l.id FROM public.leads l WHERE l.organization_id = '30bb5c27-88f4-4f91-9493-835405ae2e11';
RESET ROLE;
CREATE TEMP TABLE _plantado ON COMMIT DROP AS
WITH conversa AS (
  SELECT v.instance_id, v.phone FROM _vis v GROUP BY 1, 2 HAVING count(*) >= 2 ORDER BY 1, 2 LIMIT 1)
SELECT v.id, v.instance_id, v.phone AS normalized_phone,
       (SELECT l.id FROM public.leads l WHERE l.organization_id = '30bb5c27-88f4-4f91-9493-835405ae2e11'
          AND l.id NOT IN (SELECT id FROM _leads_vis) ORDER BY l.id LIMIT 1) AS lead_alheio
  FROM _vis v JOIN conversa c ON c.instance_id = v.instance_id AND c.phone = v.phone
 ORDER BY v.ts ASC LIMIT 1;
GRANT SELECT ON _plantado TO authenticated;
SET LOCAL session_replication_role = replica;
UPDATE public.whatsapp_messages m SET lead_id = p.lead_alheio FROM _plantado p WHERE m.id = p.id;
SET LOCAL session_replication_role = origin;
INSERT INTO _amostra SELECT DISTINCT '30bb5c27-88f4-4f91-9493-835405ae2e11'::uuid, p.instance_id, p.normalized_phone FROM _plantado p;
-- Caso plantado (desfeito pelo ROLLBACK): balcão Riofix. A persona do balcão
-- (cf616708…, escopo = funil a6d30017…) só vê conversa de lead que está no
-- funil do balcão. Uma conversa recente da caixa que ela lê ganha o card do
-- lead nesse funil; a mensagem mais ANTIGA do MESMO telefone passa a apontar
-- (lead_id) para um lead FORA do balcão. riofix_balcao_caller_chat aceita as
-- do lead do balcão e recusa a alheia (o telefone dela não é o do lead alheio).
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE _balcao ON COMMIT DROP AS
WITH conv AS (
  SELECT s.instance_id, s.normalized_phone, s.lead_id
    FROM public.whatsapp_conversation_summary s
   WHERE s.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'
     AND s.instance_id = ANY (ARRAY(SELECT w.id FROM public.whatsapp_instances w WHERE w.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'))
     AND s.lead_id IS NOT NULL AND s.last_message_direction = 'incoming'
     AND (SELECT count(*) FROM public.whatsapp_messages m
           WHERE m.organization_id = s.organization_id AND m.instance_id = s.instance_id AND m.normalized_phone = s.normalized_phone) >= 3
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.pipeline_id = 'a6d30017-e163-40df-b862-a8043bda5f30' AND e.lead_id = s.lead_id)
   ORDER BY s.last_message_time DESC LIMIT 1)
SELECT c.instance_id, c.normalized_phone, c.lead_id,
       (SELECT m.id FROM public.whatsapp_messages m
         WHERE m.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6' AND m.instance_id = c.instance_id
           AND m.normalized_phone = c.normalized_phone ORDER BY m."timestamp" ASC LIMIT 1) AS msg_alheia,
       (SELECT l.id FROM public.leads l
         WHERE l.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6' AND l.id <> c.lead_id
           AND l.normalized_phone IS DISTINCT FROM c.normalized_phone
           AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.pipeline_id = 'a6d30017-e163-40df-b862-a8043bda5f30' AND e.lead_id = l.id)
         ORDER BY l.id LIMIT 1) AS lead_alheio
  FROM conv c;
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, stage_id, metadata, entered_at, stage_changed_at, created_at, updated_at)
SELECT gen_random_uuid(), '36971ff5-fd73-4f30-a733-04bf8c90e5b6', 'a6d30017-e163-40df-b862-a8043bda5f30', b.lead_id, st.stage_key, st.id, '{}'::jsonb, now(), now(), now(), now()
  FROM _balcao b
 CROSS JOIN LATERAL (SELECT s.stage_key, s.id FROM public.pipeline_stages s
                      WHERE s.pipeline_id = 'a6d30017-e163-40df-b862-a8043bda5f30' AND s.is_active ORDER BY s.position LIMIT 1) st;
UPDATE public.whatsapp_messages m SET lead_id = b.lead_alheio FROM _balcao b WHERE m.id = b.msg_alheia;
SET LOCAL session_replication_role = origin;
GRANT SELECT ON _balcao TO authenticated;
INSERT INTO _amostra SELECT DISTINCT '36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid, b.instance_id, b.normalized_phone FROM _balcao b;
GRANT SELECT ON _amostra TO authenticated;
CREATE TEMP TABLE _cmp(persona text, n int, iguais int, com_linhas int) ON COMMIT DROP;
GRANT ALL ON _cmp TO authenticated;

CREATE FUNCTION pg_temp.comparar(p_persona text, p_org uuid) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record; v_all uuid[]; v_n int := 0; v_eq int := 0; v_rows int := 0; a jsonb; b jsonb;
BEGIN
  v_all := ARRAY(SELECT DISTINCT x.box FROM _amostra x WHERE x.org = p_org);
  FOR r IN SELECT * FROM _amostra WHERE org = p_org LOOP
    FOREACH a IN ARRAY ARRAY[to_jsonb(ARRAY[r.box]), to_jsonb(v_all)] LOOP
      b := public.whatsapp_thread_manifest(p_org, ARRAY(SELECT jsonb_array_elements_text(a)::uuid), r.phone);
      v_n := v_n + 1;
      IF b = pg_temp.manifest_rls(p_org, ARRAY(SELECT jsonb_array_elements_text(a)::uuid), r.phone) THEN v_eq := v_eq + 1; END IF;
      IF jsonb_array_length(b -> 'manifest') > 0 THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;
  INSERT INTO _cmp VALUES (p_persona, v_n, v_eq, v_rows);
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.comparar(text, uuid) TO authenticated;

CREATE FUNCTION pg_temp.como(p_uid uuid) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$f$;

SELECT pg_temp.como('c455535c-9e90-416a-a759-62c446123cfa'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('admin A', '636776d8-6282-48bc-b190-764d42785a5b'); RESET ROLE;
SELECT pg_temp.como('9fd90736-ca2e-4e3a-8d13-217abed8d6ab'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('membro A (17 de 60 caixas)', '636776d8-6282-48bc-b190-764d42785a5b');
-- (X2) caixa que o membro NÃO lê, conversa que existe nela: vazio.
SELECT is(public.whatsapp_thread_manifest('636776d8-6282-48bc-b190-764d42785a5b', ARRAY['092aa496-eab3-41d6-8991-bdf64df3aee9']::uuid[], '11000000002') -> 'manifest',
  '[]'::jsonb, '(X2) caixa não legível pelo membro: manifest vazio');
RESET ROLE;
SELECT pg_temp.como('1aa02af4-0540-46f1-94ad-7c43eef3e66a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('strict JR Tex (restrito)', '30bb5c27-88f4-4f91-9493-835405ae2e11');
-- (E5) CONTROLE do caso plantado: o oráculo sob RLS ESCONDE a mensagem…
SELECT is((SELECT count(*)::int FROM _plantado p
            WHERE (pg_temp.manifest_rls('30bb5c27-88f4-4f91-9493-835405ae2e11', ARRAY[p.instance_id], p.normalized_phone) -> 'manifest') @> jsonb_build_array(jsonb_build_object('id', p.id))),
  0, '(E5) CONTROLE: a RLS esconde a mensagem de lead alheio no número compartilhado');
-- …e o DEFINER também.
SELECT is((SELECT count(*)::int FROM _plantado p
            WHERE (public.whatsapp_thread_manifest('30bb5c27-88f4-4f91-9493-835405ae2e11', ARRAY[p.instance_id], p.normalized_phone) -> 'manifest') @> jsonb_build_array(jsonb_build_object('id', p.id))),
  0, '(E6) DEFINER esconde a mesma (predicado strict por linha)');
SELECT ok((SELECT jsonb_array_length(public.whatsapp_thread_manifest('30bb5c27-88f4-4f91-9493-835405ae2e11', ARRAY[p.instance_id], p.normalized_phone) -> 'manifest') > 0 FROM _plantado p LIMIT 1),
  '(E7) CONTROLE: o resto da conversa do membro continua visível');
RESET ROLE;
SELECT pg_temp.como('85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('JR Tex escopo Karine', '30bb5c27-88f4-4f91-9493-835405ae2e11'); RESET ROLE;
SELECT pg_temp.como('9884f2f6-90e4-4c2a-9949-2563e35727a3'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('JR Tex restrito 2', '30bb5c27-88f4-4f91-9493-835405ae2e11'); RESET ROLE;
SELECT pg_temp.como('8af3d7f4-4d68-4390-a2ae-f19c4e0a0896'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('membro Café', '4922638c-4909-494e-ba10-12282ec0b161');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM _plantado), 1, '(E4) CONTROLE: 1 mensagem plantada');
SELECT pg_temp.como('cf616708-7fc6-41a9-82e7-36b4cef01f96'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('balcão Riofix', '36971ff5-fd73-4f30-a733-04bf8c90e5b6');
-- (B1) CONTROLE: sob RLS a persona do balcão VÊ a conversa do lead do balcão…
SELECT ok((SELECT jsonb_array_length(pg_temp.manifest_rls('36971ff5-fd73-4f30-a733-04bf8c90e5b6', ARRAY[b.instance_id], b.normalized_phone) -> 'manifest') >= 1 FROM _balcao b),
  '(B1) CONTROLE: a RLS mostra ≥ 1 mensagem do lead do balcão');
-- (B2) …e esconde a mensagem com lead_id fora do balcão no MESMO telefone.
SELECT is((SELECT count(*)::int FROM _balcao b
            WHERE (pg_temp.manifest_rls('36971ff5-fd73-4f30-a733-04bf8c90e5b6', ARRAY[b.instance_id], b.normalized_phone) -> 'manifest') @> jsonb_build_array(jsonb_build_object('id', b.msg_alheia))),
  0, '(B2) CONTROLE: a RLS esconde a mensagem de lead fora do balcão');
-- (B3) O DEFINER (ramo v_balcao) esconde a mesma e mostra o resto.
SELECT is((SELECT count(*)::int FROM _balcao b
            WHERE (public.whatsapp_thread_manifest('36971ff5-fd73-4f30-a733-04bf8c90e5b6', ARRAY[b.instance_id], b.normalized_phone) -> 'manifest') @> jsonb_build_array(jsonb_build_object('id', b.msg_alheia))),
  0, '(B3) DEFINER esconde a mensagem de lead fora do balcão (predicado do balcão por linha)');
SELECT ok((SELECT public.whatsapp_thread_manifest('36971ff5-fd73-4f30-a733-04bf8c90e5b6', ARRAY[b.instance_id], b.normalized_phone)
             = pg_temp.manifest_rls('36971ff5-fd73-4f30-a733-04bf8c90e5b6', ARRAY[b.instance_id], b.normalized_phone) FROM _balcao b),
  '(B4) DEFINER == oráculo na conversa plantada do balcão');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM _balcao WHERE lead_id IS NOT NULL AND msg_alheia IS NOT NULL AND lead_alheio IS NOT NULL), 1, '(B0) CONTROLE: 1 conversa de balcão plantada');
SELECT pg_temp.como('6575eb1d-b036-4ea1-9a69-66606979f94a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('master em A', '636776d8-6282-48bc-b190-764d42785a5b'); RESET ROLE;
SELECT pg_temp.como('0e0e0e0e-0000-4000-8000-0000000000a1'); SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.whatsapp_thread_manifest('636776d8-6282-48bc-b190-764d42785a5b', ARRAY['092aa496-eab3-41d6-8991-bdf64df3aee9']::uuid[], '11000000002')$$,
  '42501', NULL, '(X1) outra org: 42501');
RESET ROLE;

SELECT is(iguais, n, '(E) ' || persona || ': manifest DEFINER == oráculo sob RLS em ' || n || ' pedidos (' || com_linhas || ' com mensagens)') FROM _cmp ORDER BY persona;
-- CONTROLES POSITIVOS: igualdade não pode vir de tudo vazio.
SELECT ok((SELECT com_linhas FROM _cmp WHERE persona = 'admin A') > 0, '(E0) CONTROLE: admin vê mensagens');
SELECT ok((SELECT com_linhas FROM _cmp WHERE persona = 'balcão Riofix') > 0, '(E0d) CONTROLE: balcão Riofix compara pedidos COM mensagens (ramo v_balcao exercitado)');
SELECT ok((SELECT com_linhas FROM _cmp WHERE persona = 'membro A (17 de 60 caixas)') > 0, '(E0b) CONTROLE: membro vê as das caixas dele');
SELECT ok((SELECT com_linhas FROM _cmp WHERE persona = 'membro A (17 de 60 caixas)') < (SELECT com_linhas FROM _cmp WHERE persona = 'admin A'),
  '(E0c) CONTROLE: membro vê MENOS que o admin (o recorte está ativo)');

SELECT * FROM finish();
ROLLBACK;
