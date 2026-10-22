-- supabase/tests/cobranca_regua_test.sql
--
-- Cobrança · entrega 2, a régua (migration 20271213000000_cobranca_regua.sql).
--
--   (GR) grants: leitura por RLS nas 3 tabelas; worker e cron só service_role;
--        internos fechados; anon sem nada
--   (IS) isolamento do número da cobrança no banco REAL: o gatilho de
--        resolve_message_lead_id de prod vincula; o da cobrança desfaz
--   (VI) vínculo: número reservado sem dono e sem copilot
--   (RP) resolve_uazapi_instance devolve reserved_for
--
-- A lógica da régua (planejar, reservar, concluir, janela, quebra) está em
-- tests/integration/cobranca-regua.test.mjs (PGlite). Aqui é o que só o banco
-- real prova: GRANT/RLS de prod e a ordem dos gatilhos de whatsapp_messages.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('c0b7b000-0000-4000-8000-00000000000a', 'Org Régua', 'org-regua', 'America/Sao_Paulo', '{"cobranca": true}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider, status) VALUES
  ('c0b7b000-0000-4000-8000-0000000005a1', 'c0b7b000-0000-4000-8000-00000000000a', 'cobrança', 'uazapi', 'connected'),
  ('c0b7b000-0000-4000-8000-0000000005a2', 'c0b7b000-0000-4000-8000-00000000000a', 'comercial', 'uazapi', 'connected');

INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, origin)
VALUES ('c0b7b000-0000-4000-8000-0000000006a1', 'c0b7b000-0000-4000-8000-00000000000a', 'Devedor Também Lead',
        '5548999997777', '5548999997777', 'meta_ads');

SET LOCAL session_replication_role = origin;

UPDATE public.whatsapp_instances SET reserved_for = 'collections'
 WHERE id = 'c0b7b000-0000-4000-8000-0000000005a1';

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(bool_and(has_table_privilege('authenticated', 'public.' || t, 'SELECT')
              AND NOT has_table_privilege('authenticated', 'public.' || t, 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.' || t, 'DELETE')
              AND NOT has_table_privilege('anon', 'public.' || t, 'SELECT')),
  'GR1: authenticated só lê as 3 tabelas da régua; anon nada')
  FROM unnest(ARRAY['cobranca_regua', 'cobranca_regua_passos', 'cobranca_regua_envios']) AS t;

SELECT ok(bool_and(c.relrowsecurity), 'GR2: RLS ligada nas 3 tabelas da régua')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('cobranca_regua', 'cobranca_regua_passos', 'cobranca_regua_envios');

SELECT ok(NOT has_function_privilege('authenticated', 'public.cobranca_regua_planejar(timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.cobranca_regua_reservar(integer, timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.cobranca_regua_concluir(uuid, text, text, text, text, timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.invoke_cobranca_regua()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.cobranca_regua_reservar(integer, timestamptz)', 'EXECUTE'),
  'GR3: worker e cron fechados para o cliente');

SELECT ok(has_function_privilege('service_role', 'public.cobranca_regua_reservar(integer, timestamptz)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.cobranca_regua_concluir(uuid, text, text, text, text, timestamptz)', 'EXECUTE'),
  'GR4: o worker (service_role) reserva e conclui');

SELECT ok(has_function_privilege('authenticated', 'public.cobranca_regua_salvar(uuid, jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.cobranca_regua_previa(uuid, timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.cobranca_regua_salvar(uuid, jsonb)', 'EXECUTE'),
  'GR5: a tela chama as RPCs dela; anon não');

SELECT ok(NOT has_function_privilege('authenticated', 'private.cobranca_regua_mover(uuid, uuid, jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'private.cobranca_regua_candidatos(uuid, timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'private.cobranca_registrar_mensagem()', 'EXECUTE'),
  'GR6: internos da régua fechados para authenticated');

SELECT ok(NOT has_function_privilege('authenticated', 'public.resolve_uazapi_instance(text, text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.resolve_uazapi_instance(text, text)', 'EXECUTE'),
  'GR7: resolve_uazapi_instance redefinida manteve o grant só de service_role');

-- ===========================================================================
-- (IS) isolamento do número da cobrança, com os gatilhos REAIS de prod
-- ===========================================================================
INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, timestamp)
VALUES
  ('c0b7b000-0000-4000-8000-00000000000a', 'c0b7b000-0000-4000-8000-0000000005a2', 'pgtap-com-1',
   '5548999997777@s.whatsapp.net', '5548999997777', 'incoming', 'conversation', 'quero comprar', now()),
  ('c0b7b000-0000-4000-8000-00000000000a', 'c0b7b000-0000-4000-8000-0000000005a1', 'pgtap-cob-1',
   '5548999997777@s.whatsapp.net', '5548999997777', 'incoming', 'conversation', 'vou pagar', now());

SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'pgtap-com-1'),
  'c0b7b000-0000-4000-8000-0000000006a1'::uuid,
  'IS1: no número comercial o resolve de prod liga ao lead (controle)');
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'pgtap-cob-1'), NULL,
  'IS2: no número da cobrança a mensagem não liga ao lead comercial');

-- ===========================================================================
-- (VI) vínculo comercial proibido no número reservado
-- ===========================================================================
SELECT throws_ok(
  $$UPDATE public.whatsapp_instances SET copilot_agent_id = gen_random_uuid()
     WHERE id = 'c0b7b000-0000-4000-8000-0000000005a1'$$,
  'PT409', NULL, 'VI1: número da cobrança não ganha copilot');

-- ===========================================================================
-- (RP) a RPC do webhook carrega o setor
-- ===========================================================================
INSERT INTO public.whatsapp_instance_secrets (instance_id, uazapi_instance_id, uazapi_token)
VALUES ('c0b7b000-0000-4000-8000-0000000005a1', 'pgtap-rcob', 'pgtap-tok-cob')
ON CONFLICT (instance_id) DO UPDATE SET uazapi_instance_id = EXCLUDED.uazapi_instance_id;

SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT is((SELECT reserved_for FROM public.resolve_uazapi_instance('pgtap-rcob', NULL)), 'collections',
  'RP1: resolve_uazapi_instance devolve reserved_for');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
