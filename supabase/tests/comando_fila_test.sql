-- supabase/tests/comando_fila_test.sql
--
-- get_comando_fila (20280123001000) == as linhas de
-- get_conversations_awaiting_human_reply_multi para as caixas do card (legíveis
-- e fora de status 'error'), NA MESMA ORDEM, + nome/dono do lead lidos sob a
-- RLS do usuário (INVOKER: lead que ele não vê ⇒ NULL). Requer a massa de perf.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_comando_fila(uuid,uuid[],integer,integer)'::regprocedure), false, '(S1) SECURITY INVOKER');
SELECT is((SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_comando_fila(uuid,uuid[],integer,integer)'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres}', '(S2) ACL: só authenticated');
SELECT ok((SELECT position('private.' IN prosrc) = 0 FROM pg_proc WHERE oid = 'public.get_comando_fila(uuid,uuid[],integer,integer)'::regprocedure),
  '(S3) nenhuma relação/função private.* no corpo INVOKER');

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

CREATE TEMP TABLE _c(caso text, novo text, antigo text, n int, com_nome int) ON COMMIT DROP;
GRANT ALL ON _c TO authenticated;
CREATE FUNCTION pg_temp.medir(p_caso text, p_org uuid) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_inst uuid[];
BEGIN
  -- As caixas que o card mandava: as do usuário (useWhatsAppInstancesForUser:
  -- status <> 'error', sob RLS) ∩ legíveis.
  v_inst := ARRAY(SELECT w.id FROM public.whatsapp_instances w
                   WHERE w.id = ANY(public.whatsapp_readable_instance_ids(p_org, NULL)) AND w.status <> 'error');
  INSERT INTO _c SELECT p_caso,
    (SELECT md5(string_agg(row(f.instance_id, f.phone_number, f.normalized_phone, f.push_name, f.lead_id, f.conversation_id,
                f.last_client_message, f.last_client_message_at, f.ai_replied, f.ai_replied_at, f.waiting_total,
                f.owner_team_member_id, f.owner_name, f.lead_name, f.lead_owner_id)::text, '|' ORDER BY f.ordinality))
       FROM public.get_comando_fila(p_org => p_org, p_limit => 30) WITH ORDINALITY f),
    CASE WHEN cardinality(v_inst) = 0 THEN NULL ELSE
    (SELECT md5(string_agg(row(a.instance_id, a.phone_number, a.normalized_phone, a.push_name, a.lead_id, a.conversation_id,
                a.last_client_message, a.last_client_message_at, a.ai_replied, a.ai_replied_at, a.waiting_total,
                a.owner_team_member_id, a.owner_name, l.name,
                COALESCE(l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id))::text, '|' ORDER BY a.ordinality))
       FROM public.get_conversations_awaiting_human_reply_multi(p_org, v_inst, 30) WITH ORDINALITY a
       LEFT JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = p_org) END,
    (SELECT count(*) FROM public.get_comando_fila(p_org => p_org, p_limit => 30)),
    (SELECT count(*) FROM public.get_comando_fila(p_org => p_org, p_limit => 30) f WHERE f.lead_name IS NOT NULL);
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.medir(text, uuid) TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"c455535c-9e90-416a-a759-62c446123cfa","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('admin A', '636776d8-6282-48bc-b190-764d42785a5b'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"9fd90736-ca2e-4e3a-8d13-217abed8d6ab","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro A (17 caixas)', '636776d8-6282-48bc-b190-764d42785a5b'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"1aa02af4-0540-46f1-94ad-7c43eef3e66a","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('strict JR Tex restrito', '30bb5c27-88f4-4f91-9493-835405ae2e11'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('JR Tex escopo Karine', '30bb5c27-88f4-4f91-9493-835405ae2e11'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"8af3d7f4-4d68-4390-a2ae-f19c4e0a0896","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('membro Café', '4922638c-4909-494e-ba10-12282ec0b161'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"cf616708-7fc6-41a9-82e7-36b4cef01f96","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('balcão Riofix', '36971ff5-fd73-4f30-a733-04bf8c90e5b6'); RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"6575eb1d-b036-4ea1-9a69-66606979f94a","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.medir('master em A', '636776d8-6282-48bc-b190-764d42785a5b');
-- (I) p_instances dado = interseção com as legíveis; caixa de outra org não entra.
SELECT is((SELECT count(*)::int FROM public.get_comando_fila(p_org => '636776d8-6282-48bc-b190-764d42785a5b',
            p_instances => ARRAY['7312692e-b9b4-4f90-aba3-09cff992bbfc']::uuid[])), 0, '(I1) caixa de outra org pedida: nada');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"0e0e0e0e-0000-4000-8000-0000000000a1","role":"authenticated"}', true); SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_comando_fila(p_org => '636776d8-6282-48bc-b190-764d42785a5b')$$, 'P0001', 'access_denied', '(X1) outra org: recusada');
RESET ROLE;

-- (V) lead invisível ⇒ nome NULL: o membro de A não vê lead fora do recorte dele? Em
-- org sem strict ele vê todos; o controle é o INVOKER: o nome vem da MESMA leitura
-- sob RLS que o oráculo faz — a igualdade (E) cobre os dois casos.
SELECT is(novo, antigo, '(E) ' || caso || ': fila idêntica à _multi + leads sob RLS (' || n || ' linhas, ' || com_nome || ' com nome)')
  FROM _c WHERE antigo IS NOT NULL ORDER BY caso;
SELECT is(n, 0, '(E) ' || caso || ': sem caixa legível, fila vazia') FROM _c WHERE antigo IS NULL ORDER BY caso;
SELECT ok((SELECT n FROM _c WHERE caso = 'admin A') > 0, '(E0) CONTROLE: admin tem fila');
SELECT ok((SELECT n FROM _c WHERE caso = 'balcão Riofix') > 0, '(E0c) CONTROLE: balcão Riofix compara fila COM linhas (conversa plantada no funil do balcão)');
SELECT ok((SELECT com_nome FROM _c WHERE caso = 'admin A') > 0, '(E0b) CONTROLE: nome de lead resolvido');

SELECT * FROM finish();
ROLLBACK;
