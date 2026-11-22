-- supabase/tests/lista_multi_nome_salvo_test.sql
--
-- get_whatsapp_conversation_list_multi (20280123000600): mesmas linhas, na
-- mesma ordem, com as mesmas 14 colunas que a versão anterior (perf_old, de
-- _perf_old_snapshot.sql) + `saved_contact_name` == o do resumo da linha.
-- Requer a massa de perf da branch e o snapshot perf_old. Rodar com
-- scripts/branch-pgtap.mjs.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(25);

SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure('public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)')),
  '{postgres=X/postgres,authenticated=X/postgres}', '(S1) ACL depois do DROP+CREATE: só authenticated');
SELECT is((SELECT (length(prosrc) - length(replace(prosrc, 'private.', ''))) / 8 FROM pg_proc
            WHERE oid = to_regprocedure('public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)')),
  CASE WHEN to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN 16 ELSE 36 END, '(S2) contagem de private. (36 na forma de prod)');
SELECT ok((SELECT position('is_conversation_marked_unread(p_org' IN prosrc) = 0 FROM pg_proc
            WHERE oid = to_regprocedure('public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)')),
  '(S3) sem sonda por linha de is_conversation_marked_unread');
SELECT is((SELECT (pg_get_function_result(to_regprocedure('public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)')))),
  'TABLE(instance_id uuid, phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer, tags jsonb, saved_contact_name text)',
  '(S4) RETURNS: as 14 de antes + saved_contact_name no FIM');

-- Caso plantado (NB4): na caixa 779f4314… (org A), que tem chip histórico
-- b06d3ccf… (mesmo número na reap queue), a conversa mais recente ganha nome
-- salvo na linha da caixa viva e uma linha MAIS NOVA do chip histórico SEM nome.
-- A lista escolhe a linha histórica (mais recente) e o nome não pode sumir.
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE _hist ON COMMIT DROP AS
SELECT s.organization_id, s.instance_id AS box, s.normalized_phone, s.phone_number, s.last_message_time, s.lead_id
  FROM public.whatsapp_conversation_summary s
 WHERE s.organization_id = '636776d8-6282-48bc-b190-764d42785a5b' AND s.instance_id = '779f4314-b940-447e-916a-f2aa9b995a05'
 ORDER BY s.last_message_time DESC LIMIT 1;
UPDATE public.whatsapp_conversation_summary s SET saved_contact_name = 'Nome da agenda (caixa viva)'
  FROM _hist h WHERE s.organization_id = h.organization_id AND s.instance_id = h.box AND s.normalized_phone = h.normalized_phone;
INSERT INTO public.whatsapp_conversation_summary (organization_id, instance_id, normalized_phone, phone_number, last_message, last_message_time,
       last_message_direction, last_push_name, lead_id, is_group, updated_at, saved_contact_name)
SELECT organization_id, 'b06d3ccf-f1e4-413d-9bc6-74251577d161', normalized_phone, phone_number, 'mensagem do chip histórico',
       last_message_time + interval '1 minute', 'incoming', 'Contato histórico', lead_id, false, now(), NULL
  FROM _hist;
SET LOCAL session_replication_role = origin;
GRANT SELECT ON _hist TO authenticated;
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

CREATE TEMP TABLE _l(caso text, novo text, antigo text, n int, nomes_ok bool, marcadas int) ON COMMIT DROP;
GRANT ALL ON _l TO authenticated;
CREATE FUNCTION pg_temp.medir(p_caso text, p_org uuid, p_unread boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_inst uuid[] := ARRAY(SELECT id FROM public.whatsapp_instances WHERE organization_id = p_org);
BEGIN
  INSERT INTO _l SELECT p_caso,
    (SELECT md5(string_agg(row(x.instance_id, x.phone_number, x.normalized_phone, x.push_name, x.last_message, x.last_message_time,
                               x.last_message_direction, x.last_message_sent_source, x.lead_id, x.is_group, x.conversation_id,
                               x.archived_at, x.unread_count, x.tags)::text, '|' ORDER BY x.ordinality))
       FROM public.get_whatsapp_conversation_list_multi(p_org => p_org, p_instances => v_inst, p_limit => 500, p_unread => p_unread) WITH ORDINALITY x),
    (SELECT md5(string_agg(row(y.instance_id, y.phone_number, y.normalized_phone, y.push_name, y.last_message, y.last_message_time,
                               y.last_message_direction, y.last_message_sent_source, y.lead_id, y.is_group, y.conversation_id,
                               y.archived_at, y.unread_count, y.tags)::text, '|' ORDER BY y.ordinality))
       FROM perf_old.get_whatsapp_conversation_list_multi(p_org => p_org, p_instances => v_inst, p_limit => 500, p_unread => p_unread) WITH ORDINALITY y),
    (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(p_org => p_org, p_instances => v_inst, p_limit => 500, p_unread => p_unread)),
    -- nome salvo == o da linha mais recente da (caixa, telefone); se nulo, o
    -- mais recente NÃO nulo entre os chips da mesma caixa (caixa viva primeiro).
    (SELECT bool_and(x.saved_contact_name IS NOT DISTINCT FROM COALESCE(
              (SELECT s.saved_contact_name FROM public.whatsapp_conversation_summary s
                WHERE s.organization_id = p_org AND s.normalized_phone = x.normalized_phone
                  AND s.instance_id = ANY (public.whatsapp_chip_instance_ids(p_org, x.instance_id))
                ORDER BY s.last_message_time DESC LIMIT 1),
              (SELECT s.saved_contact_name FROM public.whatsapp_conversation_summary s
                WHERE s.organization_id = p_org AND s.normalized_phone = x.normalized_phone
                  AND s.instance_id = ANY (public.whatsapp_chip_instance_ids(p_org, x.instance_id))
                  AND s.saved_contact_name IS NOT NULL
                ORDER BY (s.instance_id = x.instance_id) DESC, s.last_message_time DESC LIMIT 1)))
       FROM public.get_whatsapp_conversation_list_multi(p_org => p_org, p_instances => v_inst, p_limit => 500, p_unread => p_unread) x),
    (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(p_org => p_org, p_instances => v_inst, p_limit => 500, p_unread => p_unread) x
      WHERE public.is_conversation_marked_unread(p_org, x.instance_id, x.normalized_phone) AND x.unread_count >= 1);
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.medir(text, uuid, boolean) TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"c455535c-9e90-416a-a759-62c446123cfa","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('admin A', '636776d8-6282-48bc-b190-764d42785a5b');
SELECT is((SELECT x.last_message FROM public.get_whatsapp_conversation_list_multi(p_org => '636776d8-6282-48bc-b190-764d42785a5b',
             p_instances => ARRAY(SELECT id FROM public.whatsapp_instances WHERE organization_id = '636776d8-6282-48bc-b190-764d42785a5b'), p_limit => 500) x
             JOIN _hist h ON x.instance_id = h.box AND x.normalized_phone = h.normalized_phone),
  'mensagem do chip histórico', '(N1) CONTROLE: a linha escolhida é a do chip histórico (mais recente, sem nome)');
SELECT is((SELECT x.saved_contact_name FROM public.get_whatsapp_conversation_list_multi(p_org => '636776d8-6282-48bc-b190-764d42785a5b',
             p_instances => ARRAY(SELECT id FROM public.whatsapp_instances WHERE organization_id = '636776d8-6282-48bc-b190-764d42785a5b'), p_limit => 500) x
             JOIN _hist h ON x.instance_id = h.box AND x.normalized_phone = h.normalized_phone),
  'Nome da agenda (caixa viva)', '(N2) chip histórico mais recente sem nome NÃO apaga o nome salvo (COALESCE entre linhas)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"9fd90736-ca2e-4e3a-8d13-217abed8d6ab","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro A (17 caixas)', '636776d8-6282-48bc-b190-764d42785a5b');
SELECT pg_temp.medir('membro A só não-lidas', '636776d8-6282-48bc-b190-764d42785a5b', true); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"1aa02af4-0540-46f1-94ad-7c43eef3e66a","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('strict JR Tex restrito', '30bb5c27-88f4-4f91-9493-835405ae2e11'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('JR Tex escopo Karine', '30bb5c27-88f4-4f91-9493-835405ae2e11'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"8af3d7f4-4d68-4390-a2ae-f19c4e0a0896","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro Café', '4922638c-4909-494e-ba10-12282ec0b161'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"cf616708-7fc6-41a9-82e7-36b4cef01f96","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('balcão Riofix', '36971ff5-fd73-4f30-a733-04bf8c90e5b6'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"6575eb1d-b036-4ea1-9a69-66606979f94a","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('master em A', '636776d8-6282-48bc-b190-764d42785a5b'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"0e0e0e0e-0000-4000-8000-0000000000a1","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_whatsapp_conversation_list_multi(p_org => '636776d8-6282-48bc-b190-764d42785a5b', p_limit => 10)$$, '42501', NULL, '(X1) outra org: 42501');
RESET ROLE;

SELECT is(novo, antigo, '(E) ' || caso || ': 14 colunas idênticas, mesma ordem (' || n || ' linhas)') FROM _l ORDER BY caso;
SELECT ok(nomes_ok, '(N) ' || caso || ': saved_contact_name == resumo da linha') FROM _l WHERE n > 0 ORDER BY caso;
SELECT ok((SELECT n FROM _l WHERE caso = 'admin A') = 500, '(E0) CONTROLE: admin enche a página (500)');
SELECT ok((SELECT n FROM _l WHERE caso = 'balcão Riofix') > 0, '(E0c) CONTROLE: balcão Riofix compara lista COM linhas (conversa plantada no funil do balcão)');
SELECT ok((SELECT marcadas FROM _l WHERE caso = 'membro A só não-lidas') > 0, '(E0b) CONTROLE: conversa marcada como não lida aparece com contador ≥ 1');

SELECT * FROM finish();
ROLLBACK;
