-- supabase/tests/telefone_nn_resolucao_test.sql
--
-- Telefone N:N, PR2 (Chamados 99067f13 + 33c5fd52;
-- migration 20271128000000_telefone_nn_resolucao_por_negocio_aberto.sql).
--
--   (RS) resolve_message_lead_id: numero em 2 leads vivos -> o lead com negocio
--        aberto; sem negocio aberto -> NULL; 1 lead -> ele; lead apagado ignorado;
--        negocio mais recente vence; negocio fechado/apagado nao conta; 9o digito
--        (degrau normalizado); lead_id ja preenchido e respeitado.
--   (AD) adocao de orfas: numero que ja tem outro lead vivo NAO e adotado
--        (lead_phones e leads.phone); numero sem dono continua adotado.
--   (PC) leads.phone_compartilhado: coluna boolean NOT NULL DEFAULT false;
--        find_duplicate_leads ignora par em que os dois sao compartilhados.
--
-- Roda inteiro em transacao revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (triggers OFF no seed; normalized_phone explicito)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('99067f13-0000-4000-8000-00000000000a', 'Org Tel NN A', 'org-tel-nn-a', 'America/Sao_Paulo'),
  ('99067f13-0000-4000-8000-00000000000b', 'Org Tel NN B', 'org-tel-nn-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- a1/a2 dividem 48977770001 (a1 como principal, a2 como contato secundario).
-- a3 so tem um dono. a4 e a6 estao APAGADOS; a5 e vivo e tem o numero do a4 como
-- secundario. a7 e o alvo do 9o digito.
INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, deleted_at) VALUES
  ('99067f13-0000-4000-8000-0000000000a1', '99067f13-0000-4000-8000-00000000000a', 'Cliente Um',     '48977770001', '48977770001', NULL),
  ('99067f13-0000-4000-8000-0000000000a2', '99067f13-0000-4000-8000-00000000000a', 'Cliente Dois',   '48977770002', '48977770002', NULL),
  ('99067f13-0000-4000-8000-0000000000a3', '99067f13-0000-4000-8000-00000000000a', 'Cliente Tres',   '48977770003', '48977770003', NULL),
  ('99067f13-0000-4000-8000-0000000000a4', '99067f13-0000-4000-8000-00000000000a', 'Cliente Quatro', '48977770004', '48977770004', now()),
  ('99067f13-0000-4000-8000-0000000000a5', '99067f13-0000-4000-8000-00000000000a', 'Cliente Cinco',  '48977770005', '48977770005', NULL),
  ('99067f13-0000-4000-8000-0000000000a6', '99067f13-0000-4000-8000-00000000000a', 'Cliente Seis',   '48977770006', '48977770006', now()),
  ('99067f13-0000-4000-8000-0000000000a7', '99067f13-0000-4000-8000-00000000000a', 'Cliente Sete',   '48988887777', '48988887777', NULL);

INSERT INTO public.lead_phones (id, organization_id, lead_id, phone, normalized_phone, source, is_primary) VALUES
  ('99067f13-0000-4000-8000-0000000001a1', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a1', '48977770001', '48977770001', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001a2', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a2', '48977770002', '48977770002', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001b2', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a2', '48977770001', '48977770001', 'crm', false),
  ('99067f13-0000-4000-8000-0000000001a3', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a3', '48977770003', '48977770003', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001a5', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a5', '48977770005', '48977770005', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001b5', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a5', '48977770004', '48977770004', 'crm', false),
  ('99067f13-0000-4000-8000-0000000001a7', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a7', '48988887777', '48988887777', 'crm', true);

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (PC) coluna
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'leads'
             AND column_name = 'phone_compartilhado'
             AND data_type = 'boolean' AND is_nullable = 'NO'
             AND column_default = 'false'),
  'PC1: leads.phone_compartilhado e boolean NOT NULL DEFAULT false');
SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '99067f13-0000-4000-8000-00000000000a' AND phone_compartilhado),
  0, 'PC2: lead novo nasce com phone_compartilhado = false');

-- ===========================================================================
-- (RS) resolve_message_lead_id
-- ===========================================================================
-- Mensagem nova de numero compartilhado, SEM negocio aberto: nao vincula.
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770001', '48977770001', '5548977770001@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-1', now());
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-1'),
  'RS1: 2 leads vivos no numero, nenhum com negocio aberto -> lead_id NULL');

-- a2 abre negocio (mais antigo): a2 vence.
INSERT INTO public.deals (id, organization_id, title, source, source_lead_id, created_at) VALUES
  ('99067f13-0000-4000-8000-0000000002b2', '99067f13-0000-4000-8000-00000000000a', 'Negocio a2', 'manual', '99067f13-0000-4000-8000-0000000000a2', now() - interval '2 days');
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770001', '48977770001', '5548977770001@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-2', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-2'),
  '99067f13-0000-4000-8000-0000000000a2'::uuid,
  'RS2: so o a2 tem negocio aberto (e o numero e contato secundario dele) -> a2');

-- a1 abre negocio MAIS RECENTE: a1 vence.
INSERT INTO public.deals (id, organization_id, title, source, source_lead_id, created_at) VALUES
  ('99067f13-0000-4000-8000-0000000002a1', '99067f13-0000-4000-8000-00000000000a', 'Negocio a1', 'manual', '99067f13-0000-4000-8000-0000000000a1', now() - interval '1 day');
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770001', '48977770001', '5548977770001@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-3', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-3'),
  '99067f13-0000-4000-8000-0000000000a1'::uuid,
  'RS3: dois negocios abertos -> o lead do negocio mais recente');

-- Negocio do a1 fecha: volta pro a2.
UPDATE public.deals SET closed_at = now() WHERE id = '99067f13-0000-4000-8000-0000000002a1';
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770001', '48977770001', '5548977770001@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-4', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-4'),
  '99067f13-0000-4000-8000-0000000000a2'::uuid,
  'RS4: negocio fechado nao conta -> a2');

-- Negocio do a2 apagado: ninguem tem negocio aberto, volta a NULL.
UPDATE public.deals SET deleted_at = now() WHERE id = '99067f13-0000-4000-8000-0000000002b2';
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770001', '48977770001', '5548977770001@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-5', now());
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-5'),
  'RS5: negocio apagado nao conta -> NULL');

-- Um lead vivo so: resolve para ele, como hoje.
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770003', '48977770003', '5548977770003@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-6', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-6'),
  '99067f13-0000-4000-8000-0000000000a3'::uuid,
  'RS6: numero com UM lead vivo (sem negocio) -> ele');

-- Lead apagado ignorado: o numero do a4 (apagado) so tem o a5 vivo (secundario).
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770004', '48977770004', '5548977770004@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-7', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-7'),
  '99067f13-0000-4000-8000-0000000000a5'::uuid,
  'RS7: lead apagado e ignorado; o vivo com o numero (secundario) recebe');

-- Numero so de lead apagado: NULL.
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '5548977770006', '48977770006', '5548977770006@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-8', now());
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-8'),
  'RS8: numero so de lead apagado -> NULL');

-- 9o digito: 12 digitos na mensagem, 13 no lead (degrau normalizado).
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '554888887777', '4888887777', '554888887777@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-9', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-9'),
  '99067f13-0000-4000-8000-0000000000a7'::uuid,
  'RS9: casamento por 9o digito (normalize_br_mobile) segue valendo');

-- lead_id ja preenchido e respeitado, mesmo com numero compartilhado.
INSERT INTO public.whatsapp_messages (organization_id, lead_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a3', '5548977770001', '48977770001', '5548977770001@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-10', now());
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-10'),
  '99067f13-0000-4000-8000-0000000000a3'::uuid,
  'RS10: lead_id explicito nao e sobrescrito');

-- Outra org nao enxerga: mesmo numero na org B nao cai em lead da A.
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp)
VALUES ('99067f13-0000-4000-8000-00000000000b', '5548977770003', '48977770003', '5548977770003@s.whatsapp.net', 'incoming', 'oi', 'tnn-rs-11', now());
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'tnn-rs-11'),
  'RS11: isolamento por organizacao');

-- ===========================================================================
-- (AD) adocao de orfas
-- ===========================================================================
SET LOCAL session_replication_role = replica;

-- b1 ja tem 48977770010 (secundario). b2 e b3 existem sem esse numero.
INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone) VALUES
  ('99067f13-0000-4000-8000-0000000000b1', '99067f13-0000-4000-8000-00000000000a', 'Dono Um',   '48977770020', '48977770020'),
  ('99067f13-0000-4000-8000-0000000000b2', '99067f13-0000-4000-8000-00000000000a', 'Novo Dois', '48977770021', '48977770021'),
  ('99067f13-0000-4000-8000-0000000000b3', '99067f13-0000-4000-8000-00000000000a', 'Novo Tres', '48977770022', '48977770022');
INSERT INTO public.lead_phones (id, organization_id, lead_id, phone, normalized_phone, source, is_primary) VALUES
  ('99067f13-0000-4000-8000-0000000001c1', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000b1', '48977770020', '48977770020', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001c2', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000b1', '48977770010', '48977770010', 'crm', false),
  ('99067f13-0000-4000-8000-0000000001c3', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000b2', '48977770021', '48977770021', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001c4', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000b3', '48977770022', '48977770022', 'crm', true),
  ('99067f13-0000-4000-8000-0000000001c5', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000b1', '48977770013', '48977770013', 'crm', false);

-- Orfas plantadas sem passar pelo resolver: N1 (numero do b1), N2/N3 (sem dono).
INSERT INTO public.whatsapp_messages (organization_id, phone_number, normalized_phone, remote_jid, direction, content, message_id, timestamp) VALUES
  ('99067f13-0000-4000-8000-00000000000a', '5548977770010', '48977770010', '5548977770010@s.whatsapp.net', 'incoming', 'oi', 'tnn-ad-n1', now()),
  ('99067f13-0000-4000-8000-00000000000a', '5548977770011', '48977770011', '5548977770011@s.whatsapp.net', 'incoming', 'oi', 'tnn-ad-n2', now()),
  ('99067f13-0000-4000-8000-00000000000a', '5548977770012', '48977770012', '5548977770012@s.whatsapp.net', 'incoming', 'oi', 'tnn-ad-n3', now()),
  ('99067f13-0000-4000-8000-00000000000a', '5548977770013', '48977770013', '5548977770013@s.whatsapp.net', 'incoming', 'oi', 'tnn-ad-n4', now());
INSERT INTO public.whatsapp_conversation_summary (organization_id, instance_id, normalized_phone, last_message_time) VALUES
  ('99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000003f1', '48977770010', now()),
  ('99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000003f1', '48977770011', now());

SET LOCAL session_replication_role = origin;

-- Controle: orfa de numero SEM dono entra no lead (lead_phones).
INSERT INTO public.lead_phones (lead_id, phone, source)
VALUES ('99067f13-0000-4000-8000-0000000000b2', '48977770011', 'crm');
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-ad-n2'),
  '99067f13-0000-4000-8000-0000000000b2'::uuid,
  'AD1: numero sem outro dono -> lead_phones adota a mensagem orfa (comportamento mantido)');
SELECT is((SELECT lead_id FROM public.whatsapp_conversation_summary WHERE normalized_phone = '48977770011'),
  '99067f13-0000-4000-8000-0000000000b2'::uuid,
  'AD2: ... e o summary orfao');

-- Numero que o b1 ja tem: o b2 ganha o contato, mas NAO leva o historico.
INSERT INTO public.lead_phones (lead_id, phone, source)
VALUES ('99067f13-0000-4000-8000-0000000000b2', '48977770010', 'crm');
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'tnn-ad-n1'),
  'AD3: numero ja e de outro lead vivo -> lead_phones NAO adota a mensagem');
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_conversation_summary WHERE normalized_phone = '48977770010'),
  'AD4: ... nem o summary');

-- Controle (leads.phone): orfa de numero sem dono entra no lead.
UPDATE public.leads SET phone = '48977770012' WHERE id = '99067f13-0000-4000-8000-0000000000b3';
SELECT is((SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'tnn-ad-n3'),
  '99067f13-0000-4000-8000-0000000000b3'::uuid,
  'AD5: troca de leads.phone para numero sem dono adota a orfa (comportamento mantido)');

-- leads.phone para um numero que o b1 ja tem (secundario): nao adota.
UPDATE public.leads SET phone = '48977770013' WHERE id = '99067f13-0000-4000-8000-0000000000b2';
SELECT ok((SELECT lead_id IS NULL FROM public.whatsapp_messages WHERE message_id = 'tnn-ad-n4'),
  'AD6: troca de leads.phone para numero que outro lead vivo ja tem NAO adota a orfa');

-- ===========================================================================
-- (PC) find_duplicate_leads
-- ===========================================================================
SET LOCAL session_replication_role = replica;
INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, email, phone_compartilhado) VALUES
  ('99067f13-0000-4000-8000-0000000000c1', '99067f13-0000-4000-8000-00000000000b', 'Zeta Alfa Importadora', '11911110001', '11911110001', 'mesmo@dup.test', true),
  ('99067f13-0000-4000-8000-0000000000c2', '99067f13-0000-4000-8000-00000000000b', 'Omega Beta Servicos',    '11911110002', '11911110002', 'mesmo@dup.test', true);
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.find_duplicate_leads('99067f13-0000-4000-8000-00000000000b')),
  0, 'PC3: par em que os DOIS tem phone_compartilhado e ignorado');

UPDATE public.leads SET phone_compartilhado = false WHERE id = '99067f13-0000-4000-8000-0000000000c2';
SELECT is(
  (SELECT count(*)::int FROM public.find_duplicate_leads('99067f13-0000-4000-8000-00000000000b')),
  1, 'PC4: se so um e compartilhado, o par volta a aparecer');

SELECT * FROM finish();
ROLLBACK;
