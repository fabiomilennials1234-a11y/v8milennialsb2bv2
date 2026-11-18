// get_whatsapp_conversation_list_multi com pré-filtro do recorte strict
// (20280119040000_lista_multi_strict_pre_filtro.sql).
//
// O recorte aqui é o de PROD, com os corpos EXATOS (md5 conferido) de
// strict_phone_visible, strict_lead_is_owned, strict_lead_member_orgs e
// jrtex_izadora_new_chat, aplicado por views private.* com o mesmo predicado
// das views de prod. Provado, como `authenticated` COM claims:
//   a. equivalência: a função viva (o rollback = 20280117000000 em forma de
//      prod, md5 conferido) e a nova devolvem as mesmas linhas, na mesma ordem,
//      em 6 cenários × 6 usuários — membro sob o recorte (pré-filtro LIGA),
//      admin (fora do recorte), escopo de funil JR Tex, caixa da Izadora,
//      balcão Riofix (os três: pré-filtro DESLIGA) e usuário de outra org
//      strict sem leads — sobre um conjunto que exercita: lead do membro por
//      responsável, por co-dono, por entrada de funil (assigned_to e
//      metadata), lead apagado, resumo com lead de outro, resumo sem lead
//      com telefone do membro, conversa (whatsapp_conversations) visível e
//      invisível, não-lida, etiqueta de conversa;
//   b. o pré-filtro LIGA e poupa: strict_phone_visible avaliada bem menos
//      vezes para o membro, e o mesmo tanto para quem fica fora dele;
//   c. com o recorte em plpgsql (forma de 20280119000000) o pré-filtro segue
//      ligado e a saída igual;
//   d. corpo do recorte mudou (drift) → pré-filtro DESLIGA sozinho, saída
//      igual à do corpo novo;
//   e. forma de prod (35 `private.`, leituras do pré-filtro na TABELA) e
//      forma do repo (aplica e roda, pré-filtro desligado);
//   f. gate de org 42501 e ACL nas duas versões.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280119040000_lista_multi_strict_pre_filtro.sql');
const RB = read('../../supabase/migrations/rollback/20280119040000_lista_multi_strict_pre_filtro.sql');
const md5 = (s) => createHash('md5').update(s).digest('hex');

const SIG = 'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)';
const RELS = ['conversation_read_state', 'conversations', 'lead_tags', 'leads', 'pipeline_entries',
  'whatsapp_conversation_summary', 'whatsapp_conversations', 'whatsapp_messages'];

// Corpos VIVOS de prod (prosrc), 16/11/2026 — byte a byte, inclusive CRLF.
const SRC = {
  member_orgs: "SELECT ARRAY(SELECT DISTINCT x FROM unnest((\r\n SELECT ARRAY(SELECT DISTINCT org FROM unnest(( SELECT ARRAY(\r\n    SELECT o.id FROM public.organizations o\r\n    WHERE o.feature_flags @> '{\"strict_lead_owner_access\":true}'::jsonb\r\n      AND COALESCE(auth.role(), '') <> 'service_role'\r\n      AND (auth.uid() IS NOT NULL OR COALESCE(auth.role(), '') IN ('authenticated', 'anon'))\r\n      AND NOT COALESCE(public.is_master_user(), false)\r\n      AND NOT EXISTS (\r\n        SELECT 1 FROM public.team_members tm\r\n        WHERE tm.organization_id = o.id AND tm.user_id = auth.uid()\r\n          AND tm.is_active AND tm.role = 'admin'\r\n      )\r\n  ) ) || CASE WHEN private.riofix_balcao_current_scope() IS NOT NULL THEN ARRAY['36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid] ELSE '{}'::uuid[] END) org)\r\n) || CASE WHEN private.jrtex_caller_lead_scoped() THEN ARRAY['30bb5c27-88f4-4f91-9493-835405ae2e11'::uuid] ELSE '{}'::uuid[] END) x)",
  is_owned: "SELECT CASE WHEN private.jrtex_karine_pending_lead(p_org,p_lead) THEN true WHEN private.jrtex_lead_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.jrtex_caller_lead(p_org,p_lead) ELSE (\r\n SELECT CASE WHEN private.riofix_balcao_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.riofix_balcao_caller_lead(p_org,p_lead) ELSE (SELECT auth.uid() IS NOT NULL AND EXISTS (\r\n    SELECT 1 FROM public.leads l\r\n    JOIN public.team_members tm ON tm.organization_id = l.organization_id\r\n      AND tm.user_id = auth.uid() AND tm.is_active\r\n    WHERE l.id = p_lead AND l.organization_id = p_org AND l.deleted_at IS NULL\r\n      AND (\r\n        tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)\r\n        OR EXISTS (\r\n          SELECT 1 FROM public.lead_owners own\r\n          WHERE own.lead_id = l.id AND own.organization_id = p_org\r\n            AND own.team_member_id = tm.id AND own.role = 'co'\r\n        )\r\n        OR EXISTS (\r\n          SELECT 1 FROM public.pipeline_entries pe\r\n          WHERE pe.lead_id = l.id AND pe.organization_id = p_org\r\n            AND (pe.assigned_to = tm.id OR tm.id::text IN (\r\n              pe.metadata->>'pre_sale_responsible_id', pe.metadata->>'sale_responsible_id',\r\n              pe.metadata->>'sdr_id', pe.metadata->>'closer_id', pe.metadata->>'responsible_id'\r\n            ))\r\n        )\r\n      )\r\n  )) END\r\n) END",
  phone_visible: "\r\n SELECT CASE WHEN private.jrtex_karine_orphan_chat(auth.uid(),p_org,p_lead,p_phone) THEN true WHEN private.jrtex_izadora_new_chat(auth.uid(),p_org,p_lead,p_phone) THEN true WHEN private.riofix_balcao_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.riofix_balcao_caller_chat(p_org,p_lead,p_phone) ELSE (SELECT NOT (p_org=ANY((SELECT private.strict_lead_member_orgs())::uuid[]))\r\n    OR EXISTS (\r\n      SELECT 1 FROM public.leads l WHERE l.organization_id=p_org\r\n        AND ((p_lead IS NOT NULL AND l.id=p_lead)\r\n          OR (p_lead IS NULL AND l.normalized_phone=p_phone))\r\n        AND private.strict_lead_is_owned(p_org,l.id)\r\n    )) END\r\n",
  izadora_new_chat: "\n SELECT CASE WHEN private.jrtex_izadora_inbox_scope(p_user,p_org) THEN\n EXISTS(\n SELECT 1 FROM public.whatsapp_conversation_summary s\n WHERE s.organization_id=p_org\n AND s.instance_id='45149134-35d6-4be2-8668-81d6210542c0'::uuid\n AND NOT s.is_group\n AND s.normalized_phone=coalesce(nullif(p_phone,''),(SELECT l.normalized_phone FROM public.leads l WHERE l.id=p_lead AND l.organization_id=p_org AND l.deleted_at IS NULL))\n AND (p_lead IS NULL OR EXISTS(SELECT 1 FROM public.leads l WHERE l.id=p_lead AND l.organization_id=p_org AND l.deleted_at IS NULL AND l.normalized_phone=s.normalized_phone))\n AND NOT EXISTS(\n SELECT 1 FROM public.leads l JOIN public.pipeline_entries pe ON pe.lead_id=l.id AND pe.organization_id=l.organization_id\n WHERE l.organization_id=p_org AND l.deleted_at IS NULL\n AND (l.normalized_phone=s.normalized_phone OR l.id=p_lead OR l.id=s.lead_id)\n )\n ) ELSE false END\n",
};

const id = (p, n) => `${p}000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const JRTEX = '30bb5c27-88f4-4f91-9493-835405ae2e11';
const RIOFIX = '36971ff5-fd73-4f30-a733-04bf8c90e5b6';
const IZADORA_BOX = '45149134-35d6-4be2-8668-81d6210542c0';
const ORG = JRTEX; // a org strict de verdade, para os ramos JR Tex/Izadora existirem
const ORG2 = id('0a', 2); // outra org strict
const U = { mem: id('0b', 1), adm: id('0b', 2), jr: id('0b', 3), iza: '1aa02af4-0540-46f1-94ad-7c43eef3e66a', rf: id('0b', 5), vazio: id('0b', 6), kar: '85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea' };
const U_FORA = id('0b', 9);
const TM = { mem: id('0c', 1), adm: id('0c', 2), jr: id('0c', 3), iza: id('0c', 4), rf: id('0c', 5), vazio: id('0c', 6), kar: id('0c', 7) };
const A = IZADORA_BOX, B = id('0d', 2);
const L = { dono: id('0e', 1), co: id('0e', 2), pipe: id('0e', 3), meta: id('0e', 4), alheio: id('0e', 5), apagado: id('0e', 6), semDono: id('0e', 7) };
const P = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i + 1}`, `55479000000${String(i + 1).padStart(2, '0')}`]));
const TAG = id('0f', 1);

const SKELETON = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, chat_restrict_to_owner boolean NOT NULL DEFAULT false,
  feature_flags jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member', name text);
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.member_feature_permissions (team_member_id uuid, feature_key text, enabled boolean);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid, responsible_id uuid,
  qualification_tier text);
CREATE TABLE public.lead_owners (lead_id uuid, organization_id uuid, team_member_id uuid, role text);
CREATE TABLE public.lead_phones (organization_id uuid, lead_id uuid, normalized_phone text, deleted_at timestamptz);
CREATE TABLE public.pipeline_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, lead_id uuid,
  pipeline_id uuid, stage_key text, assigned_to uuid, metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.conversations (organization_id uuid, lead_id uuid, state text);
CREATE TABLE public.conversation_read_state (organization_id uuid, user_id uuid, conversation_key text,
  last_read_at timestamptz, marked_unread boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, user_id, conversation_key));
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid, phone_number text);
CREATE TABLE public.whatsapp_instance_reap_queue (instance_id uuid, organization_id uuid, phone_number text);
CREATE TABLE public.whatsapp_conversations (id uuid PRIMARY KEY, organization_id uuid, instance_id uuid,
  normalized_phone text, archived_at timestamptz, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.whatsapp_conversation_summary (organization_id uuid, instance_id uuid, normalized_phone text,
  phone_number text, last_push_name text, last_message text, last_message_time timestamptz,
  last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, instance_id, normalized_phone));
CREATE TABLE public.whatsapp_messages (organization_id uuid, instance_id uuid, normalized_phone text, lead_id uuid,
  direction text, deleted_at timestamptz, is_group boolean NOT NULL DEFAULT false, "timestamp" timestamptz,
  content text, sent_source text, push_name text);
CREATE TABLE public.tags (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, color text);
CREATE TABLE public.lead_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, tag_id uuid,
  created_at timestamptz DEFAULT now(), UNIQUE (lead_id, tag_id));
CREATE TABLE public.whatsapp_conversation_tags (conversation_id uuid, tag_id uuid, UNIQUE (conversation_id, tag_id));

CREATE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.master_users WHERE user_id = _user_id AND is_active = true); END $$;
CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT organization_id FROM public.team_members WHERE user_id = auth.uid() AND is_active $$;
CREATE FUNCTION public.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[]) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(wi.id ORDER BY wi.id), '{}') FROM public.whatsapp_instances wi
   WHERE wi.organization_id = p_org
     AND (p_instances IS NULL OR cardinality(p_instances) = 0 OR wi.id = ANY(p_instances)) $$;
CREATE FUNCTION public.is_org_admin(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT COALESCE(public.is_master_user(), false) OR EXISTS (SELECT 1 FROM public.team_members
   WHERE user_id = auth.uid() AND organization_id = p_org AND role = 'admin' AND is_active) $$;
CREATE FUNCTION public.rls_lead_co_owned(p_lead uuid, p_tms uuid[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.lead_owners o WHERE o.lead_id = p_lead AND o.role = 'co'
   AND o.team_member_id = ANY(p_tms)) $$;
CREATE FUNCTION public.is_conversation_marked_unread(p_org uuid, p_instance uuid, p_phone text)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.conversation_read_state
 WHERE organization_id = p_org AND user_id = auth.uid()
 AND conversation_key = 'whatsapp:' || p_instance::text || ':' || p_phone AND marked_unread);
$$;

INSERT INTO public.organizations(id, feature_flags) VALUES
  ('${ORG}', '{"strict_lead_owner_access":true}'), ('${ORG2}', '{"strict_lead_owner_access":true}'),
  ('${RIOFIX}', '{}');
INSERT INTO public.team_members(id, user_id, organization_id, role) VALUES
  ('${TM.mem}', '${U.mem}', '${ORG}', 'member'), ('${TM.adm}', '${U.adm}', '${ORG}', 'admin'),
  ('${TM.jr}', '${U.jr}', '${ORG}', 'member'), ('${TM.iza}', '${U.iza}', '${ORG}', 'member'),
  ('${TM.rf}', '${U.rf}', '${ORG}', 'member'), ('${TM.vazio}', '${U.vazio}', '${ORG}', 'member'), ('${TM.kar}', '${U.kar}', '${ORG}', 'member'),
  ('${id('0c', 9)}', '${U_FORA}', '${ORG2}', 'admin');
INSERT INTO public.whatsapp_instances VALUES ('${A}', '${ORG}', '5547999990001'), ('${B}', '${ORG}', '5547999990002');
INSERT INTO public.leads(id, organization_id, normalized_phone, deleted_at, sale_responsible_id, sdr_id) VALUES
  ('${L.dono}', '${ORG}', '${P.p1}', NULL, '${TM.mem}', NULL),
  ('${L.co}', '${ORG}', '${P.p2}', NULL, NULL, NULL),
  ('${L.pipe}', '${ORG}', '${P.p3}', NULL, NULL, NULL),
  ('${L.meta}', '${ORG}', '${P.p4}', NULL, NULL, NULL),
  ('${L.alheio}', '${ORG}', '${P.p5}', NULL, '${TM.adm}', NULL),
  ('${L.apagado}', '${ORG}', '${P.p6}', now(), '${TM.mem}', NULL),
  ('${L.semDono}', '${ORG}', '${P.p8}', NULL, NULL, NULL);
INSERT INTO public.lead_owners VALUES ('${L.co}', '${ORG}', '${TM.mem}', 'co');
INSERT INTO public.pipeline_entries(organization_id, lead_id, pipeline_id, stage_key, assigned_to, metadata) VALUES
  ('${ORG}', '${L.pipe}', '${id('09', 1)}', 'novo', '${TM.mem}', '{}'),
  ('${ORG}', '${L.meta}', '${id('09', 1)}', 'novo', NULL, '{"closer_id":"${TM.mem}"}');

-- Mensagens recebidas e o resumo derivado delas (como o trigger faz).
INSERT INTO public.whatsapp_messages
  (organization_id, instance_id, normalized_phone, lead_id, direction, deleted_at, is_group, "timestamp", content, sent_source, push_name)
SELECT '${ORG}', v.inst::uuid, v.np, v.lead::uuid, 'incoming', NULL, false, now() - (v.min || ' minutes')::interval, v.np, NULL, 'X'
  FROM (VALUES
    ('${A}', '${P.p1}', '${L.dono}', 1),     -- responsável
    ('${A}', '${P.p2}', '${L.co}', 2),       -- co-dono
    ('${A}', '${P.p3}', '${L.pipe}', 3),     -- funil assigned_to
    ('${B}', '${P.p4}', '${L.meta}', 4),     -- funil metadata
    ('${A}', '${P.p5}', '${L.alheio}', 5),   -- lead de outro
    ('${A}', '${P.p6}', '${L.apagado}', 6),  -- lead apagado
    ('${A}', '${P.p7}', NULL, 7),            -- sem lead, telefone de ninguém
    ('${B}', '${P.p1}', NULL, 8),            -- sem lead, telefone do lead do membro
    ('${A}', '${P.p8}', '${L.semDono}', 9),  -- lead sem dono
    ('${A}', '${P.p9}', '${L.alheio}', 10)   -- telefone diferente com lead de outro
  ) v(inst, np, lead, min);
INSERT INTO public.whatsapp_conversation_summary
SELECT DISTINCT ON (m.organization_id, m.instance_id, m.normalized_phone)
       m.organization_id, m.instance_id, m.normalized_phone, m.normalized_phone, m.push_name, m.content,
       m."timestamp", m.direction, m.sent_source, m.lead_id, m.is_group
  FROM public.whatsapp_messages m
 ORDER BY m.organization_id, m.instance_id, m.normalized_phone, m."timestamp" DESC;
INSERT INTO public.whatsapp_conversations(id, organization_id, instance_id, normalized_phone, created_at) VALUES
  ('${id('0f', 11)}', '${ORG}', '${A}', '${P.p1}', now() - interval '1 day'),
  ('${id('0f', 12)}', '${ORG}', '${A}', '${P.p5}', now() - interval '1 day'),
  ('${id('0f', 13)}', '${ORG}', '${A}', '${P.p2}', now() - interval '2 days');
INSERT INTO public.tags VALUES ('${TAG}', '${ORG}', 'quente', '#f00');
INSERT INTO public.whatsapp_conversation_tags VALUES ('${id('0f', 11)}', '${TAG}'), ('${id('0f', 12)}', '${TAG}');
INSERT INTO public.conversation_read_state(organization_id, user_id, conversation_key, last_read_at, marked_unread)
SELECT '${ORG}', u, 'whatsapp:${A}:${P.p2}', now(), false
  FROM unnest(ARRAY['${U.mem}', '${U.adm}', '${U.jr}', '${U.iza}', '${U.rf}', '${U.vazio}', '${U.kar}']::uuid[]) u;
`;

// O recorte de PROD: corpos exatos + views private.* com o predicado de prod.
const PROD_SHAPE = `
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE SEQUENCE private.chamadas;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE private.chamadas TO authenticated;
-- Ramos não genéricos: quem é quem (tabela de botões).
CREATE TABLE private.knobs (jr_user uuid, rf_user uuid);
INSERT INTO private.knobs VALUES ('${U.jr}', '${U.rf}');
GRANT SELECT ON private.knobs TO authenticated;
CREATE FUNCTION private.jrtex_lead_scope_for_user(p_user uuid, p_org uuid) RETURNS text LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN p_org <> '${JRTEX}'::uuid THEN NULL
              WHEN p_user = '${U.iza}'::uuid THEN 'profit'
              WHEN p_user = (SELECT jr_user FROM private.knobs) THEN 'SP' END $$;
CREATE FUNCTION private.jrtex_caller_lead(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$ SELECT p_lead = '${L.alheio}'::uuid $$;
CREATE FUNCTION private.jrtex_caller_lead_scoped() RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private.jrtex_lead_scope_for_user(auth.uid(), '${JRTEX}') IS NOT NULL $$;
-- Contador: chamada uma vez por avaliação de strict_phone_visible (primeiro
-- ramo do CASE vivo, via jrtex_izadora_new_chat).
CREATE FUNCTION private.jrtex_izadora_inbox_scope(p_user uuid, p_org uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE
  SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  PERFORM nextval('private.chamadas');
  RETURN p_user = '${U.iza}'::uuid AND p_org = '${JRTEX}'::uuid;
END $$;
CREATE FUNCTION private.riofix_balcao_scope_for_user(p_user uuid, p_org uuid) RETURNS uuid LANGUAGE sql STABLE
  SET search_path TO '' AS $$
  SELECT '${id('09', 7)}'::uuid FROM private.knobs k WHERE k.rf_user = p_user AND p_org = '${JRTEX}'::uuid $$;
CREATE FUNCTION private.riofix_balcao_current_scope() RETURNS uuid LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION private.riofix_balcao_caller_lead(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$ SELECT p_lead = '${L.semDono}'::uuid $$;
CREATE FUNCTION private.riofix_balcao_caller_chat(p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p_lead = '${L.semDono}'::uuid OR p_phone = '${P.p7}' $$;
CREATE FUNCTION private.jrtex_pipeline_scoped() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION private.jrtex_visible_pipeline_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT '{}'::uuid[] $$;
CREATE TABLE private.whatsapp_user_instance_restrictions (organization_id uuid, user_id uuid, enabled boolean,
  allowed_instance_ids uuid[]);

-- Ramos hard-wired de prod para a usuária da Karine (JR Tex): neutros aqui
-- (false), exceto a trava do pré-filtro, que tira o usuário dela do atalho.
CREATE FUNCTION private.jrtex_karine_pending_lead(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $$ SELECT false $$;
CREATE FUNCTION private.jrtex_karine_orphan_chat(p_user uuid, p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT false $$;
CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO '' AS $body$${SRC.member_orgs}$body$;
CREATE FUNCTION private.strict_lead_is_owned(p_org uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO '' AS $body$${SRC.is_owned}$body$;
CREATE FUNCTION private.jrtex_izadora_new_chat(p_user uuid, p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $body$${SRC.izadora_new_chat}$body$;
CREATE FUNCTION private.strict_phone_visible(p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $body$${SRC.phone_visible}$body$;

-- Views com o predicado de prod (recorte strict; sem a restrição por caixa).
CREATE VIEW private.whatsapp_conversation_summary AS
  SELECT * FROM public.whatsapp_conversation_summary s
   WHERE NOT (s.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_phone_visible(s.organization_id, s.lead_id, s.normalized_phone);
CREATE VIEW private.whatsapp_conversations AS
  SELECT * FROM public.whatsapp_conversations c
   WHERE NOT (c.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_phone_visible(c.organization_id, NULL, c.normalized_phone);
CREATE VIEW private.whatsapp_messages AS
  SELECT * FROM public.whatsapp_messages m
   WHERE NOT (m.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_phone_visible(m.organization_id, m.lead_id, m.normalized_phone);
CREATE VIEW private.leads WITH (security_invoker = true) AS
  SELECT * FROM public.leads l
   WHERE NOT (l.organization_id = ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
      OR private.strict_lead_is_owned(l.organization_id, l.id);
CREATE VIEW private.conversation_read_state WITH (security_invoker = true) AS SELECT * FROM public.conversation_read_state;
CREATE VIEW private.conversations WITH (security_invoker = true) AS SELECT * FROM public.conversations;
CREATE VIEW private.lead_tags WITH (security_invoker = true) AS SELECT * FROM public.lead_tags;
CREATE VIEW private.lead_phones WITH (security_invoker = true) AS SELECT * FROM public.lead_phones;
CREATE VIEW private.pipeline_entries WITH (security_invoker = true) AS SELECT * FROM public.pipeline_entries;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`;

const PROD_ACL = `
REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;
`;

async function db({ prodShape = true } = {}) {
  const pg = new PGlite();
  await pg.exec(SKELETON);
  if (prodShape) await pg.exec(PROD_SHAPE);
  return pg;
}

async function call(pg, user, args = {}) {
  await pg.query(`SELECT set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ sub: user, role: 'authenticated' })]);
  await pg.exec('SET ROLE authenticated');
  try {
    const who = await pg.query('SELECT auth.uid() AS uid, current_user AS r');
    assert.equal(who.rows[0].uid, user, 'claims não chegaram');
    assert.equal(who.rows[0].r, 'authenticated');
    const r = await pg.query(
      `SELECT * FROM public.get_whatsapp_conversation_list_multi(
         p_org => $1, p_instances => $2::uuid[], p_limit => $3, p_unread => $4, p_tags => $5::uuid[],
         p_lead_presence => $6)`,
      [ORG, args.instances ?? null, args.limit ?? 50, args.unread ?? null, args.tags ?? null, args.presence ?? null],
    );
    return r.rows;
  } finally {
    await pg.exec('RESET ROLE');
    await pg.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const chamadas = async (pg) => Number((await pg.query(`SELECT nextval('private.chamadas') AS v`)).rows[0].v);

const SCENARIOS = {
  padrao: {},
  naoLidas: { unread: true },
  etiqueta: { tags: [TAG] },
  caixaB: { instances: [B] },
  limite2: { limit: 2 },
  semLead: { presence: 'sem' },
};

async function snapshot(pg) {
  const out = {};
  for (const [who, user] of Object.entries(U)) {
    for (const [name, args] of Object.entries(SCENARIOS)) {
      const c0 = await chamadas(pg);
      out[`${who}/${name}`] = await call(pg, user, args);
      out[`${who}/${name}#chamadas`] = (await chamadas(pg)) - c0 - 1;
    }
  }
  return out;
}

const linhas = (out) => Object.fromEntries(Object.entries(out).filter(([k]) => !k.includes('#')));
const fones = (rows) => rows.map((r) => `${r.instance_id === A ? 'A' : 'B'}:${r.normalized_phone}`).sort();

test('corpos do teste são os de prod (md5 travado na migration)', () => {
  assert.equal(md5(SRC.phone_visible), '042c6dcd662f6e188868d0f62c031d35');
  assert.equal(md5(SRC.is_owned), 'cd65d7ad967b5ace6704eb948ada4cd3');
  assert.equal(md5(SRC.izadora_new_chat), '76d54226fcad6ee83d2766c14957cab1');
  assert.equal(md5(SRC.member_orgs), '422ec5d40d1a0574efd6f2786e1a118e');
  for (const h of ['042c6dcd662f6e188868d0f62c031d35', 'cd65d7ad967b5ace6704eb948ada4cd3', '76d54226fcad6ee83d2766c14957cab1',
    md5(`BEGIN RETURN (${SRC.phone_visible}); END`), md5(`BEGIN RETURN (${SRC.is_owned}); END`)]) {
    assert.ok(MIG.includes(h), `migration aceita ${h}`);
  }
});

test('a+b: mesma saída da função viva; o pré-filtro liga só para o ramo genérico e poupa avaliações', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(PROD_ACL);
  const antes = await snapshot(pg);
  await pg.exec(MIG);
  const depois = await snapshot(pg);
  assert.deepEqual(linhas(depois), linhas(antes));

  // O conjunto exercita o que diz.
  assert.deepEqual(fones(antes['mem/padrao']),
    [`A:${P.p1}`, `A:${P.p2}`, `A:${P.p3}`, `B:${P.p1}`, `B:${P.p4}`].sort(),
    'membro: responsável, co-dono, funil (2 formas) e resumo sem lead com telefone dele');
  assert.equal(antes['adm/padrao'].length, 10, 'admin fora do recorte vê tudo');
  assert.ok(fones(antes['jr/padrao']).includes(`A:${P.p5}`), 'escopo JR Tex: ramo próprio');
  assert.ok(fones(antes['iza/padrao']).includes(`A:${P.p7}`), 'Izadora: conversa nova sem funil');
  assert.deepEqual(antes['vazio/padrao'], [], 'membro sem leads não vê nada');
  assert.equal(antes['mem/padrao'].find((r) => r.normalized_phone === P.p1 && r.instance_id === A).conversation_id,
    id('0f', 11), 'conversa visível casada');
  assert.deepEqual(fones(antes['mem/etiqueta']), [`A:${P.p1}`], 'etiqueta de conversa');

  // Pré-filtro: o membro (e o sem-leads) avaliam o recorte muito menos; os
  // ramos não genéricos e o admin avaliam igual.
  for (const name of Object.keys(SCENARIOS)) {
    // Ramo genérico: nunca mais que antes (+1 da própria checagem)...
    for (const who of ['mem', 'vazio']) {
      assert.ok(depois[`${who}/${name}#chamadas`] <= antes[`${who}/${name}#chamadas`] + 1,
        `${who}/${name}: ${antes[`${who}/${name}#chamadas`]} → ${depois[`${who}/${name}#chamadas`]}`);
    }
    // Fora do ramo genérico: mesmas avaliações (+1 no máximo: a própria
    // checagem do pré-filtro consulta o escopo da Izadora, que é o contador).
    for (const who of ['adm', 'jr', 'iza', 'rf', 'kar']) {
      const d = depois[`${who}/${name}#chamadas`] - antes[`${who}/${name}#chamadas`];
      assert.ok(d === 0 || d === 1, `${who}/${name}: pré-filtro desligado (Δ ${d})`);
    }
  }
  // ...e, onde a leitura cobre a org inteira, as 5 linhas do resumo que o
  // membro não vê (p5–p9) deixam de ser avaliadas (−1 da própria checagem).
  for (const name of ['padrao', 'naoLidas', 'etiqueta', 'limite2', 'semLead']) {
    assert.ok(antes[`mem/${name}#chamadas`] - depois[`mem/${name}#chamadas`] >= 4,
      `mem/${name}: ${antes[`mem/${name}#chamadas`]} → ${depois[`mem/${name}#chamadas`]}`);
  }
  assert.ok(depois['vazio/padrao#chamadas'] <= 1, 'sem leads: nenhuma linha chega ao recorte (só a checagem)');
});

test('c: recorte em plpgsql (forma de 20280119000000) — pré-filtro segue ligado, mesma saída', async () => {
  const pg = await db();
  await pg.exec(RB);
  const antes = await snapshot(pg);
  await pg.exec(MIG);
  for (const [sig, src] of [['private.strict_phone_visible(uuid,uuid,text)', SRC.phone_visible],
    ['private.strict_lead_is_owned(uuid,uuid)', SRC.is_owned]]) {
    const def = (await pg.query(`SELECT pg_get_functiondef('${sig}'::regprocedure) AS d`)).rows[0].d;
    await pg.exec(def.slice(0, def.indexOf('AS $')).replace(' LANGUAGE sql', ' LANGUAGE plpgsql')
      + 'AS ' + `$w$BEGIN RETURN (${src}); END$w$`);
  }
  const depois = await snapshot(pg);
  assert.deepEqual(linhas(depois), linhas(antes));
  assert.ok(depois['mem/padrao#chamadas'] < antes['mem/padrao#chamadas'], 'pré-filtro ligado');
});

test('d: corpo do recorte mudou → pré-filtro desliga e a saída segue o corpo novo', async () => {
  const pg = await db();
  await pg.exec(MIG);
  // Drift: agora lead sem dono também é visível para todo membro.
  const def = (await pg.query(`SELECT pg_get_functiondef('private.strict_lead_is_owned(uuid,uuid)'::regprocedure) AS d`)).rows[0].d;
  await pg.exec(def.slice(0, def.indexOf('AS $')) + 'AS ' + `$w$${SRC.is_owned.replace(
    'tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)',
    "tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id) OR COALESCE(l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id) IS NULL")}$w$`);
  const c0 = await chamadas(pg);
  const rows = await call(pg, U.mem);
  assert.ok(fones(rows).includes(`A:${P.p8}`), 'regra nova (lead sem dono) aparece: não ficou presa ao pré-filtro');
  assert.ok((await chamadas(pg)) - c0 - 1 >= 10, 'pré-filtro desligado: recorte avaliado em toda linha');
});

test('e: forma de prod (35 private., ramo da Karine, pré-filtro na tabela) e forma do repo', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(MIG);
  const def = (await pg.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  const sobra = def.match(new RegExp(`public\\.(${RELS.join('|')})(?![A-Za-z0-9_"])`, 'g')) ?? [];
  assert.deepEqual(sobra, []);
  assert.equal((def.match(/private\./g) ?? []).length, 35);
  assert.ok(def.includes('private.jrtex_karine_orphan_chat(v_uid, p_org, NULL::uuid, s.normalized_phone)'), 'ramo da Karine do corpo vivo');
  assert.ok(!def.includes('KARINE_ORPHAN'), 'marcador substituído');
  for (const t of ['leads', 'team_members', 'lead_owners', 'pipeline_entries']) {
    assert.ok(def.includes(`public."${t}"`), `pré-filtro lê public."${t}"`);
  }

  const repo = await db({ prodShape: false });
  await repo.exec(MIG);
  const d2 = (await repo.query(`SELECT pg_get_functiondef('${SIG}'::regprocedure) AS d`)).rows[0].d;
  assert.ok(!/private\.(leads|whatsapp_|conversation)/.test(d2));
  assert.equal((await call(repo, U.mem)).length, 10, 'sem recorte instalado: lista inteira, pré-filtro desligado');
});

test('f: gate de org 42501 e ACL nas duas versões', async () => {
  const pg = await db();
  await pg.exec(RB);
  await pg.exec(PROD_ACL);
  await assert.rejects(call(pg, U_FORA), (e) => e.code === '42501');
  await pg.exec(MIG);
  await assert.rejects(call(pg, U_FORA), (e) => e.code === '42501');
  const r = (await pg.query(`SELECT
      has_function_privilege('anon', '${SIG}', 'EXECUTE') AS anon,
      has_function_privilege('service_role', '${SIG}', 'EXECUTE') AS service_role,
      has_function_privilege('authenticated', '${SIG}', 'EXECUTE') AS authenticated`)).rows[0];
  assert.deepEqual(r, { anon: false, service_role: false, authenticated: true });
});
