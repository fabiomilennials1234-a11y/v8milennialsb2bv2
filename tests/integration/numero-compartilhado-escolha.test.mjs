// Número em 2+ cadastros: escolha explícita + vínculo anterior (PGlite, sem Docker).
//
// Migrations sob teste:
//   20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql
//   supabase/ops/backfill-numero-compartilhado-vinculo-anterior.sql
//   + os dois rollbacks.
//
// Corpos de prod copiados com pg_get_functiondef em 09/11/2026, sem mudar lógica:
// normalize_brazilian_phone, normalize_br_mobile, normalize_whatsapp_message_phone,
// is_master_user, get_my_member_organization_ids, org_access_blocked,
// get_my_organization_ids, assert_org_access, can_see_chat, can_see_chat_scope,
// private.strict_phone_visible, private.chat_scope_for_recipient,
// private.cobranca_isolar_mensagem, tg_whatsapp_conversation_summary.
// O estado ANTES é a definição de prod de resolve_message_lead_id, aplicada pelo
// rollback (md5 do corpo = prod, 4a43358d…).
// Stubs (sem efeito nos casos daqui): riofix_balcao_* (org não é Riofix),
// strict_lead_* (sem strict_lead_owner_access), get_my_gestor_organization_ids.
// private.whatsapp_readable_message_instance_ids lê a tabela de teste
// test_caixas_legiveis (em prod: whatsapp_readable_instance_ids × chip_instance_ids
// da caixa); a semântica que importa aqui é "array de caixas que o usuário lê".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MIG = '../../supabase/migrations/';
const FWD = '20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql';
const OPS = '../../supabase/ops/';
const BACKFILL = 'backfill-numero-compartilhado-vinculo-anterior.sql';
const BACKFILL_ROLLBACK = 'rollback-backfill-numero-compartilhado-vinculo-anterior.sql';

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = u(1);
const ORG2 = u(2);
const INST_NOVA = u(10);
const INST_REMOVIDA = u(11); // existe em mensagens, não em whatsapp_instances (caso Cliente Exemplo)
const INST_COBRANCA = u(12);
const INST_OUTRA = u(13); // caixa que USER_MEMBRO não lê
const L_PF = u(21); // principal (leads.normalized_phone)
const L_PJ = u(22); // via lead_phones (teve o negócio que fechou)
const L_PJ2 = u(23); // via lead_phones
const L_OUTRA_ORG = u(24);
const L_SOZINHO = u(25);
const USER_MEMBRO = u(31);
const USER_OUTRA_ORG = u(32);
const USER_INATIVO = u(33);
const USER_SEM_ORG = u(34);
const NUM = '42999990001';
const NUM_WA = '554299990001'; // como chega da Uazapi (sem o 9)
const HISTORICO_PF = 26; // linhas do generate_series do SEED (de 6 em 6 h até 19/10 14:25 UTC)

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA private;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.role', true), '') $$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY, feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  subscription_status text, billing_override boolean, chat_restrict_to_owner boolean);
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, role text NOT NULL DEFAULT 'member');
CREATE TABLE public.master_users (user_id uuid, is_active boolean);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.member_feature_permissions (team_member_id uuid, feature_key text, enabled boolean);
CREATE TABLE public.lead_owners (lead_id uuid, team_member_id uuid, role text);
CREATE TABLE public.pipelines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  is_active boolean NOT NULL DEFAULT true, config jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE public.test_caixas_legiveis (user_id uuid, instance_id uuid);
CREATE FUNCTION private.whatsapp_readable_message_instance_ids() RETURNS uuid[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
  SELECT COALESCE(array_agg(DISTINCT c.instance_id), ARRAY[]::uuid[])
    FROM public.test_caixas_legiveis c WHERE c.user_id = auth.uid() AND auth.uid() IS NOT NULL $f$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text, company text, erp_code text,
  phone_digits text NOT NULL DEFAULT '', normalized_phone text, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid);
CREATE TABLE public.lead_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL,
  phone_digits text NOT NULL, normalized_phone text, deleted_at timestamptz);
CREATE TABLE public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, source_lead_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, deleted_at timestamptz);
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid, reserved_for text);
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, instance_id uuid,
  phone_number text, normalized_phone text, lead_id uuid, direction text DEFAULT 'incoming',
  "timestamp" timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz, is_group boolean DEFAULT false);
CREATE INDEX idx_whatsapp_msgs_org_phone_instance_ts ON public.whatsapp_messages
  (organization_id, normalized_phone, instance_id, "timestamp" DESC)
  WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL;
CREATE TABLE public.whatsapp_conversation_summary (
  organization_id uuid NOT NULL, instance_id uuid NOT NULL, normalized_phone text NOT NULL,
  phone_number text, last_message text, last_message_time timestamptz,
  last_message_direction text, last_message_sent_source text, last_push_name text,
  lead_id uuid, is_group boolean NOT NULL DEFAULT false, updated_at timestamptz,
  PRIMARY KEY (organization_id, instance_id, normalized_phone));
GRANT SELECT, UPDATE ON public.whatsapp_messages TO authenticated;

-- ── prod ────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.normalize_brazilian_phone(phone text) RETURNS text
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
DECLARE cleaned TEXT;
BEGIN
  IF phone IS NULL OR phone = '' THEN RETURN NULL; END IF;
  cleaned := regexp_replace(phone, '\\D', '', 'g');
  IF cleaned = '' THEN RETURN NULL; END IF;
  IF length(cleaned) >= 12 AND left(cleaned, 2) = '55' THEN cleaned := substring(cleaned from 3); END IF;
  IF length(cleaned) = 10 THEN cleaned := left(cleaned, 2) || '9' || substring(cleaned from 3); END IF;
  RETURN cleaned;
END; $f$;
CREATE FUNCTION public.normalize_br_mobile(digits text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path TO 'public' AS $f$
  SELECT CASE
    WHEN length(digits) = 13 AND left(digits, 2) = '55' THEN digits
    WHEN length(digits) = 12 AND left(digits, 2) = '55' THEN left(digits, 4) || '9' || substr(digits, 5)
    WHEN length(digits) = 11 AND substr(digits, 3, 1) = '9' THEN '55' || digits
    WHEN length(digits) = 10 THEN '55' || left(digits, 2) || '9' || substr(digits, 3)
    ELSE digits END; $f$;
CREATE FUNCTION public.normalize_whatsapp_message_phone() RETURNS trigger
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
BEGIN NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone_number); RETURN NEW; END; $f$;

CREATE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN RETURN EXISTS (SELECT 1 FROM public.master_users WHERE user_id = _user_id AND is_active = true); END; $f$;
CREATE FUNCTION public.get_my_gestor_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid WHERE false $f$;
CREATE FUNCTION public.get_my_member_organization_ids() RETURNS SETOF uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT organization_id FROM public.team_members WHERE user_id = auth.uid() AND is_active = true
  UNION SELECT * FROM public.get_my_gestor_organization_ids(); $f$;
CREATE FUNCTION public.org_access_blocked(p_org_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT o.subscription_status IN ('suspended','cancelled','expired') AND NOT COALESCE(o.billing_override,false)
    FROM public.organizations o WHERE o.id = p_org_id), false); $f$;
CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT m.org_id FROM public.get_my_member_organization_ids() AS m(org_id) WHERE NOT public.org_access_blocked(m.org_id); $f$;
CREATE FUNCTION public.assert_org_access(p_org_id uuid) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;
  IF public.is_master_user() THEN RETURN; END IF;
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS t(org_id) WHERE t.org_id = p_org_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
END; $f$;

CREATE FUNCTION private.riofix_balcao_scope_for_user(uuid, uuid) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT NULL::text $f$;
CREATE FUNCTION private.riofix_balcao_chat_for_user(uuid, uuid, uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
CREATE FUNCTION private.riofix_balcao_caller_chat(uuid, uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql STABLE AS $f$ SELECT '{}'::uuid[] $f$;
CREATE FUNCTION private.strict_lead_is_owned(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
CREATE FUNCTION private.strict_lead_owned_by(uuid, uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;

CREATE FUNCTION private.strict_phone_visible(p_org uuid, p_lead uuid, p_phone text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
 SELECT CASE WHEN private.riofix_balcao_scope_for_user(auth.uid(),p_org) IS NOT NULL THEN private.riofix_balcao_caller_chat(p_org,p_lead,p_phone) ELSE (SELECT NOT (p_org=ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id=p_org
        AND ((p_lead IS NOT NULL AND l.id=p_lead) OR (p_lead IS NULL AND l.normalized_phone=p_phone))
        AND private.strict_lead_is_owned(p_org,l.id))) END $f$;

CREATE FUNCTION private.chat_scope_for_recipient(p_user_id uuid, p_org_id uuid, p_lead_id uuid, p_normalized_phone text) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_team_member_id uuid; v_restricted boolean;
BEGIN
 IF private.riofix_balcao_scope_for_user(p_user_id,p_org_id) IS NOT NULL THEN
   RETURN private.riofix_balcao_chat_for_user(p_user_id,p_org_id,p_lead_id,p_normalized_phone);
 END IF;
  IF public.is_master_user(p_user_id) THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;
  SELECT id INTO v_team_member_id FROM public.team_members
   WHERE user_id = p_user_id AND organization_id = p_org_id AND is_active = true LIMIT 1;
  IF v_team_member_id IS NULL THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org_id AND feature_flags @> '{"strict_lead_owner_access":true}'::jsonb) THEN
    RETURN EXISTS(SELECT 1 FROM public.team_members WHERE id=v_team_member_id AND role='admin')
      OR EXISTS(SELECT 1 FROM public.leads l WHERE l.organization_id=p_org_id
        AND ((p_lead_id IS NOT NULL AND l.id=p_lead_id) OR (p_lead_id IS NULL AND l.normalized_phone=p_normalized_phone))
        AND private.strict_lead_owned_by(p_org_id,l.id,p_user_id));
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin') OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND role = 'admin' AND is_active) THEN RETURN true; END IF;
  SELECT chat_restrict_to_owner INTO v_restricted FROM public.organizations WHERE id = p_org_id;
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.member_feature_permissions WHERE team_member_id = v_team_member_id AND feature_key = 'leads.view_all' AND enabled) THEN RETURN true; END IF;
  IF p_lead_id IS NULL AND p_normalized_phone IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
      AND ((p_lead_id IS NOT NULL AND l.id = p_lead_id) OR (p_lead_id IS NULL AND l.normalized_phone = p_normalized_phone))
      AND (COALESCE(v_team_member_id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id), false)
        OR EXISTS (SELECT 1 FROM public.lead_owners lo WHERE lo.lead_id = l.id AND lo.team_member_id = v_team_member_id AND lo.role = 'co')
        OR (COALESCE(l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id) IS NULL
          AND EXISTS (SELECT 1 FROM public.member_feature_permissions WHERE team_member_id = v_team_member_id AND feature_key = 'leads.view_unassigned' AND enabled))));
END; $f$;

CREATE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
 SELECT (NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=p_org_id
           AND o.feature_flags @> '{"strict_lead_owner_access":true}'::jsonb)
         OR private.strict_phone_visible(p_org_id,p_lead_id,p_normalized_phone))
   AND private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone); $f$;
CREATE FUNCTION public.can_see_chat(p_org_id uuid, p_normalized_phone text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT public.can_see_chat_scope(p_org_id, NULL, p_normalized_phone) $f$;

CREATE FUNCTION private.cobranca_isolar_mensagem() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.instance_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.whatsapp_instances w WHERE w.id = NEW.instance_id AND w.reserved_for = 'collections') THEN
    NEW.lead_id := NULL;
  END IF;
  RETURN NEW;
END $f$;

CREATE FUNCTION public.tg_whatsapp_conversation_summary() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.instance_id IS NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.whatsapp_conversation_summary AS s
    (organization_id, instance_id, normalized_phone, phone_number, last_message_time, lead_id, is_group, updated_at)
  VALUES (NEW.organization_id, NEW.instance_id, NEW.normalized_phone, NEW.phone_number, NEW."timestamp", NEW.lead_id, coalesce(NEW.is_group, false), now())
  ON CONFLICT (organization_id, instance_id, normalized_phone) DO UPDATE SET
    last_message_time = greatest(s.last_message_time, EXCLUDED.last_message_time),
    lead_id = COALESCE(s.lead_id, EXCLUDED.lead_id),
    updated_at = now();
  RETURN NEW;
END $f$;

CREATE TRIGGER trg_normalize_whatsapp_message_phone BEFORE INSERT OR UPDATE OF phone_number ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION normalize_whatsapp_message_phone();
CREATE TRIGGER trg_whatsapp_conversation_summary AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION tg_whatsapp_conversation_summary();
`;

// Os BEFORE de prod, na ordem alfabética real: normalize → resolve → zz_cobranca.
const TRIGGERS = `
CREATE TRIGGER trg_resolve_message_lead_id BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION resolve_message_lead_id();
CREATE TRIGGER trg_resolve_message_lead_id_zz_cobranca BEFORE INSERT OR UPDATE OF lead_id ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.cobranca_isolar_mensagem();
`;

const SEED = `
INSERT INTO auth.users VALUES ('${USER_MEMBRO}'), ('${USER_OUTRA_ORG}'), ('${USER_INATIVO}'), ('${USER_SEM_ORG}');
INSERT INTO public.organizations (id) VALUES ('${ORG}'), ('${ORG2}');
INSERT INTO public.team_members (user_id, organization_id, is_active) VALUES
  ('${USER_MEMBRO}', '${ORG}', true), ('${USER_OUTRA_ORG}', '${ORG2}', true), ('${USER_INATIVO}', '${ORG}', false);
INSERT INTO public.whatsapp_instances VALUES ('${INST_NOVA}', '${ORG}', NULL), ('${INST_COBRANCA}', '${ORG}', 'collections'),
  ('${INST_OUTRA}', '${ORG}', NULL);
-- USER_MEMBRO (não admin) lê só a caixa nova (e a de cobrança).
INSERT INTO public.test_caixas_legiveis VALUES ('${USER_MEMBRO}', '${INST_NOVA}'), ('${USER_MEMBRO}', '${INST_COBRANCA}');
INSERT INTO public.leads (id, organization_id, name, company, erp_code, phone_digits, normalized_phone) VALUES
  ('${L_PF}', '${ORG}', 'Cliente Exemplo', NULL, '90061', '${NUM}', '${NUM}'),
  ('${L_PJ}', '${ORG}', 'Cliente Exemplo ME', 'Exemplo Cafés', '90510', '42911110000', '42911110000'),
  ('${L_PJ2}', '${ORG}', 'Exemplo Filial', 'Exemplo Cafés', '90177', '42922220000', '42922220000'),
  ('${L_OUTRA_ORG}', '${ORG2}', 'Outra org', NULL, NULL, '${NUM}', '${NUM}'),
  ('${L_SOZINHO}', '${ORG}', 'Sozinho', NULL, NULL, '48988887777', '48988887777');
INSERT INTO public.lead_phones (organization_id, lead_id, phone_digits, normalized_phone) VALUES
  ('${ORG}', '${L_PJ}', '${NUM}', '${NUM}'), ('${ORG}', '${L_PJ2}', '${NUM}', '${NUM}');
-- O único negócio, fechado em 19/10.
INSERT INTO public.deals (organization_id, source_lead_id, created_at, closed_at)
VALUES ('${ORG}', '${L_PJ}', '2026-09-01', '2026-10-19 12:13+00');
-- Histórico até 19/10 14:25 vinculado ao PF, numa caixa que já não existe.
INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, lead_id, "timestamp", created_at)
SELECT '${ORG}', '${INST_REMOVIDA}', '${NUM_WA}', '${L_PF}', t, t
  FROM generate_series('2026-10-13 06:00+00'::timestamptz, '2026-10-19 14:25+00', interval '6 hours') t;
`;

async function setup() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  // Estado de prod em 09/11: a definição antiga vem do rollback.
  await db.exec(read(MIG + 'rollback/' + FWD));
  await db.exec(TRIGGERS);
  await db.exec(SEED);
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
let seq = 0;
async function recebe(db, { phone = NUM_WA, inst = INST_NOVA, org = ORG, at } = {}) {
  seq += 1;
  const ts = at ?? `2026-11-0${1 + (seq % 8)} 10:${String(seq % 60).padStart(2, '0')}+00`;
  return (await one(db,
    `INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, "timestamp")
     VALUES ($1, $2, $3, $4) RETURNING lead_id`, [org, inst, phone, ts])).lead_id;
}
async function como(db, uid) {
  await db.exec(`RESET ROLE; SELECT set_config('test.uid', '${uid ?? ''}', false); SELECT set_config('test.role', '${uid ? 'authenticated' : 'anon'}', false); SET ROLE ${uid ? 'authenticated' : 'anon'}`);
}
async function admin(db) {
  await db.exec(`RESET ROLE; SELECT set_config('test.uid', '', false); SELECT set_config('test.role', '', false)`);
}
const escolher = (db, org, phone, lead) =>
  one(db, 'SELECT public.escolher_lead_do_numero($1, $2, $3) AS n', [org, phone, lead]).then((r) => r.n);

test('regressão de 19/10 reproduzida: definição antiga deixa a mensagem do Cliente Exemplo sem lead', async () => {
  const db = await setup();
  assert.equal(await recebe(db), null);
});

test('migration aplica e é reaplicável', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.exec(read(MIG + FWD));
});

test('2c — caso Cliente Exemplo: 3 cadastros, negócio fechado, vínculo anterior em caixa removida → herda o PF', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  assert.equal(await recebe(db), L_PF);
  // Também pelo degrau 1 (dígitos exatos) e numa caixa sem instância.
  assert.equal(await recebe(db, { phone: NUM, inst: null }), L_PF);
});

test('1 candidato: inalterado', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  assert.equal(await recebe(db, { phone: '5548988887777' }), L_SOZINHO);
});

test('2c — vínculo anterior a lead que deixou de ser candidato é ignorado', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.exec(`UPDATE public.leads SET deleted_at = now() WHERE id = '${L_PF}'`);
  // Restam PJ e PJ2 (2 candidatos), último vínculo é do PF apagado → nenhum.
  assert.equal(await recebe(db), null);
});

test('2c — o vínculo mais recente vale, não o mais antigo', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, lead_id, "timestamp")
                  VALUES ($1, $2, $3, $4, '2026-10-25')`, [ORG, INST_NOVA, NUM_WA, L_PJ2]);
  assert.equal(await recebe(db), L_PJ2);
});

test('2b vence 2c: negócio aberto decide antes do vínculo anterior', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.exec(`INSERT INTO public.deals (organization_id, source_lead_id, created_at) VALUES ('${ORG}', '${L_PJ2}', '2026-11-01')`);
  assert.equal(await recebe(db), L_PJ2);
});

test('2a vence 2b: escolha explícita decide antes do negócio aberto; escolha de ex-candidato é ignorada', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.exec(`INSERT INTO public.deals (organization_id, source_lead_id, created_at) VALUES ('${ORG}', '${L_PJ2}', '2026-11-01')`);
  await como(db, USER_MEMBRO);
  await escolher(db, ORG, NUM_WA, L_PJ);
  await admin(db);
  assert.equal(await recebe(db), L_PJ);
  // Lead escolhido sai do número (contato apagado): a escolha deixa de valer.
  await db.exec(`UPDATE public.lead_phones SET deleted_at = now() WHERE lead_id = '${L_PJ}'`);
  assert.equal(await recebe(db), L_PJ2);
});

test('lead_id já preenchido no INSERT é respeitado', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  const r = await one(db, `INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, lead_id, "timestamp")
    VALUES ($1, $2, $3, $4, now()) RETURNING lead_id`, [ORG, INST_NOVA, NUM_WA, L_PJ2]);
  assert.equal(r.lead_id, L_PJ2);
});

test('RPC: vincula só as órfãs do número, grava a escolha e o resumo do inbox', async () => {
  const db = await setup();
  // 3 órfãs da regressão (antes do fix) + 1 já vinculada a outro lead (sem caixa)
  // + 1 na caixa de cobrança.
  for (let i = 0; i < 3; i++) await recebe(db);
  await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, lead_id, "timestamp")
                  VALUES ($1, NULL, $2, $3, now())`, [ORG, NUM_WA, L_PJ2]);
  await recebe(db, { inst: INST_COBRANCA });
  await db.exec(read(MIG + FWD));
  const resumoAntes = await one(db, `SELECT lead_id FROM public.whatsapp_conversation_summary WHERE instance_id = $1`, [INST_NOVA]);
  assert.equal(resumoAntes.lead_id, null);

  await como(db, USER_MEMBRO);
  assert.equal(await escolher(db, ORG, '+55 (42) 9999-0001', L_PJ), 3);
  await admin(db);

  const porLead = (await db.query(`SELECT lead_id, count(*)::int AS n FROM public.whatsapp_messages
     WHERE instance_id <> $1 OR instance_id IS NULL GROUP BY 1 ORDER BY 2`, [INST_COBRANCA])).rows;
  assert.deepEqual(Object.fromEntries(porLead.map((r) => [r.lead_id, r.n])), { [L_PJ]: 3, [L_PJ2]: 1, [L_PF]: HISTORICO_PF });
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_messages WHERE instance_id = $1`, [INST_COBRANCA])).lead_id, null);
  const esc = await one(db, `SELECT * FROM public.whatsapp_numero_lead_escolhido`);
  assert.equal(esc.normalized_phone, NUM);
  assert.equal(esc.lead_id, L_PJ);
  assert.equal(esc.escolhido_por, USER_MEMBRO);
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_conversation_summary WHERE instance_id = $1`, [INST_NOVA])).lead_id, L_PJ);

  // Trocar a escolha atualiza a linha (PK org+número) e não revincula as já vinculadas.
  await como(db, USER_MEMBRO);
  assert.equal(await escolher(db, ORG, NUM, L_PJ2), 0);
  await admin(db);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.whatsapp_numero_lead_escolhido`)).n, 1);
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_numero_lead_escolhido`)).lead_id, L_PJ2);
});

test('RPC: gate — sem sessão, não-membro, membro inativo, outra org, lead não candidato, lead de outra org', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.exec(`GRANT EXECUTE ON FUNCTION public.escolher_lead_do_numero(uuid, text, uuid) TO anon`); // só p/ provar o gate interno
  const recusa = async (uid, org, lead, re) => {
    await como(db, uid);
    await assert.rejects(escolher(db, org, NUM_WA, lead), re);
    await admin(db);
  };
  await recusa(null, ORG, L_PF, /access_denied/);
  await recusa(USER_SEM_ORG, ORG, L_PF, /access_denied/);
  await recusa(USER_INATIVO, ORG, L_PF, /access_denied/);
  await recusa(USER_OUTRA_ORG, ORG, L_PF, /access_denied/);
  // Membro da org 2 tentando usar a org 2 com lead da org 1: não é cadastro do número lá.
  await recusa(USER_OUTRA_ORG, ORG2, L_PF, /não tem mais este número/);
  await recusa(USER_MEMBRO, ORG, L_SOZINHO, /não tem mais este número/);
  await recusa(USER_MEMBRO, ORG, L_OUTRA_ORG, /não tem mais este número/);
  await recusa(USER_MEMBRO, ORG, null, /numero_ou_lead_invalido/);
  await db.exec(`UPDATE public.leads SET deleted_at = now() WHERE id = '${L_PJ2}'`);
  await recusa(USER_MEMBRO, ORG, L_PJ2, /não tem mais este número/);
  // Conversa invisível ao membro (chat_restrict_to_owner, lead de outro dono).
  await db.exec(`UPDATE public.organizations SET chat_restrict_to_owner = true WHERE id = '${ORG}';
                 UPDATE public.leads SET sdr_id = gen_random_uuid() WHERE organization_id = '${ORG}'`);
  await recusa(USER_MEMBRO, ORG, L_PF, /access_denied/);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.whatsapp_numero_lead_escolhido`)).n, 0);
});

test('grants: anon e service_role sem EXECUTE; authenticated com; private sem grant; tabela só leitura', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  const fn = 'public.escolher_lead_do_numero(uuid, text, uuid)';
  const priv = async (role, obj, p) => (await one(db, `SELECT has_function_privilege($1, $2, $3) AS ok`, [role, obj, p])).ok;
  assert.equal(await priv('anon', fn, 'EXECUTE'), false);
  assert.equal(await priv('service_role', fn, 'EXECUTE'), false);
  assert.equal(await priv('authenticated', fn, 'EXECUTE'), true);
  for (const f of ['private.leads_vivos_do_numero(uuid, text)', 'private.ultimo_lead_vinculado_ao_numero(uuid, text)',
                   'private.lead_do_numero_ambiguo(uuid, text, uuid[])', 'private.vinculo_de_lead_tem_efeito_externo(uuid)']) {
    for (const r of ['anon', 'authenticated', 'service_role']) assert.equal(await priv(r, f, 'EXECUTE'), false, `${r} ${f}`);
  }
  const tab = async (role, p) => (await one(db, `SELECT has_table_privilege($1, 'public.whatsapp_numero_lead_escolhido', $2) AS ok`, [role, p])).ok;
  assert.equal(await tab('anon', 'SELECT'), false);
  assert.equal(await tab('authenticated', 'SELECT'), true);
  for (const p of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.equal(await tab('authenticated', p), false, p);
    assert.equal(await tab('service_role', p), false, p);
  }
  const sec = await one(db, `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [fn]);
  assert.equal(sec.prosecdef, true);
  assert.deepEqual(sec.proconfig, ['search_path=""']);
  assert.equal((await one(db, `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.whatsapp_numero_lead_escolhido'::regclass`)).relrowsecurity, true);
});

test('RLS da escolha: membro da org lê; outra org não; INSERT direto recusado', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await como(db, USER_MEMBRO);
  await escolher(db, ORG, NUM, L_PF);
  assert.equal((await db.query(`SELECT lead_id FROM public.whatsapp_numero_lead_escolhido`)).rows.length, 1);
  await assert.rejects(db.query(`INSERT INTO public.whatsapp_numero_lead_escolhido (organization_id, normalized_phone, lead_id)
                                 VALUES ($1, '48911112222', $2)`, [ORG, L_SOZINHO]), /permission denied/);
  await assert.rejects(db.query(`UPDATE public.whatsapp_numero_lead_escolhido SET lead_id = $1`, [L_PJ]), /permission denied/);
  await como(db, USER_OUTRA_ORG);
  assert.equal((await db.query(`SELECT lead_id FROM public.whatsapp_numero_lead_escolhido`)).rows.length, 0);
  await admin(db);
});

test('backfill: órfãs herdam o vínculo anterior, idempotente, rollback desfaz só o que fez', async () => {
  const db = await setup();
  // Órfãs da regressão (definição antiga): 4 na caixa nova.
  for (let i = 0; i < 4; i++) await recebe(db);
  // Órfã de número ambíguo SEM vínculo anterior: fica órfã.
  await db.exec(`INSERT INTO public.lead_phones (organization_id, lead_id, phone_digits, normalized_phone)
                 VALUES ('${ORG}', '${L_SOZINHO}', '48977770001', '48977770001'),
                        ('${ORG}', '${L_PJ2}', '48977770001', '48977770001')`);
  await recebe(db, { phone: '5548977770001' });
  // Órfã anterior a 19/10: fora do recorte.
  await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, "timestamp", created_at, lead_id)
                  VALUES ($1, $2, $3, '2026-10-10', '2026-10-10', NULL)`, [ORG, INST_NOVA, NUM_WA]);
  await db.exec(`UPDATE public.whatsapp_messages SET lead_id = NULL WHERE created_at = '2026-10-10'`);
  await db.exec(read(MIG + FWD));
  await db.exec(read(OPS + BACKFILL));

  const n = async (where) => (await one(db, `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE ${where}`)).n;
  assert.equal(await n(`instance_id = '${INST_NOVA}' AND normalized_phone = '${NUM}' AND lead_id = '${L_PF}'`), 4);
  assert.equal(await n(`created_at = '2026-10-10' AND lead_id IS NULL`), 1);
  assert.equal(await n(`normalized_phone = '48977770001' AND lead_id IS NULL`), 1);
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_conversation_summary WHERE instance_id = $1 AND normalized_phone = $2`, [INST_NOVA, NUM])).lead_id, L_PF);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM private.backfill_numero_compartilhado_mensagens`)).n, 4);

  // Idempotente.
  await db.exec(read(OPS + BACKFILL));
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM private.backfill_numero_compartilhado_mensagens`)).n, 4);

  // Rollback do backfill volta exatamente as 4 e o resumo.
  await db.exec(read(OPS + BACKFILL_ROLLBACK));
  assert.equal(await n(`instance_id = '${INST_NOVA}' AND normalized_phone = '${NUM}' AND lead_id IS NULL`), 5);
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_conversation_summary WHERE instance_id = $1 AND normalized_phone = $2`, [INST_NOVA, NUM])).lead_id, null);
  assert.equal(await n(`lead_id = '${L_PF}'`), HISTORICO_PF);
});

test('backfill: número com negócio aberto ou escolha explícita fica fora', async () => {
  const db = await setup();
  for (let i = 0; i < 2; i++) await recebe(db);
  await db.exec(read(MIG + FWD));
  await db.exec(`INSERT INTO public.deals (organization_id, source_lead_id) VALUES ('${ORG}', '${L_PJ2}')`);
  await db.exec(read(OPS + BACKFILL));
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE lead_id IS NULL`)).n, 2);
});

test('backfill: GUARDA aborta tudo se o alvo encostar em org com efeito externo no UPDATE', async () => {
  const db = await setup();
  for (let i = 0; i < 2; i++) await recebe(db);
  await db.exec(read(MIG + FWD));
  await db.exec(`INSERT INTO public.pipelines (organization_id, config)
                 VALUES ('${ORG}', '{"first_human_outbound_stage": {"enabled": true}}')`);
  await assert.rejects(db.exec(read(OPS + BACKFILL)), /efeito externo/);
  await db.exec('ROLLBACK');
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE lead_id IS NULL`)).n, 2);
});

test('RPC: membro que só lê a caixa 1 não vincula órfãs da caixa 2, mas a escolha rege INSERT novo na caixa 2', async () => {
  const db = await setup();
  await recebe(db);                       // órfã na caixa que ele lê
  await recebe(db, { inst: INST_OUTRA }); // órfã na caixa que ele NÃO lê
  await recebe(db, { inst: null });       // órfã sem caixa: fora para não-admin (como a policy)
  await db.exec(read(MIG + FWD));
  await como(db, USER_MEMBRO);
  assert.equal(await escolher(db, ORG, NUM_WA, L_PJ2), 1);
  await admin(db);
  const porCaixa = async (inst) => (await one(db,
    `SELECT lead_id FROM public.whatsapp_messages WHERE instance_id IS NOT DISTINCT FROM $1 AND lead_id IS DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1`,
    [inst, L_PF])).lead_id;
  assert.equal(await porCaixa(INST_NOVA), L_PJ2);
  assert.equal(await porCaixa(INST_OUTRA), null);
  assert.equal(await porCaixa(null), null);
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_conversation_summary WHERE instance_id = $1`, [INST_OUTRA])).lead_id, null);
  assert.equal((await one(db, `SELECT lead_id FROM public.whatsapp_conversation_summary WHERE instance_id = $1`, [INST_NOVA])).lead_id, L_PJ2);
  // A escolha é da org: mensagem NOVA na caixa 2 nasce no lead escolhido.
  assert.equal(await recebe(db, { inst: INST_OUTRA }), L_PJ2);
});

test('RPC: admin ativo da org vincula as órfãs de todas as caixas (inclusive sem caixa)', async () => {
  const db = await setup();
  await recebe(db);
  await recebe(db, { inst: INST_OUTRA });
  await recebe(db, { inst: null });
  await db.exec(read(MIG + FWD));
  await db.exec(`UPDATE public.team_members SET role = 'admin' WHERE user_id = '${USER_MEMBRO}'`);
  await como(db, USER_MEMBRO);
  assert.equal(await escolher(db, ORG, NUM_WA, L_PJ2), 3);
  await admin(db);
});

test('RPC: em org com efeito externo no UPDATE de lead_id, vincula só incoming', async () => {
  const db = await setup();
  await recebe(db);
  await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, phone_number, direction, "timestamp")
                  VALUES ($1, $2, $3, 'outgoing', now())`, [ORG, INST_NOVA, NUM_WA]);
  await db.exec(read(MIG + FWD));
  await db.exec(`INSERT INTO public.pipelines (organization_id, config)
                 VALUES ('${ORG}', '{"first_human_outbound_stage": {"enabled": true}}')`);
  await como(db, USER_MEMBRO);
  assert.equal(await escolher(db, ORG, NUM_WA, L_PJ2), 1);
  await admin(db);
  const r = (await db.query(`SELECT direction, lead_id FROM public.whatsapp_messages WHERE instance_id = $1 ORDER BY direction`, [INST_NOVA])).rows;
  assert.deepEqual(r, [{ direction: 'incoming', lead_id: L_PJ2 }, { direction: 'outgoing', lead_id: null }]);
  // Pipeline inativo não conta; Riofix conta sempre.
  await db.exec(`UPDATE public.pipelines SET is_active = false`);
  const fx = async (org) => (await one(db, 'SELECT private.vinculo_de_lead_tem_efeito_externo($1) AS v', [org])).v;
  assert.equal(await fx(ORG), false);
  assert.equal(await fx('36971ff5-fd73-4f30-a733-04bf8c90e5b6'), true);
});

test('backfill: aborta se a forward não foi aplicada', async () => {
  const db = await setup();
  await assert.rejects(db.exec(read(OPS + BACKFILL)), /aplique antes a migration 20280102000000/);
  await db.exec('ROLLBACK');
});

test('rollback da forward volta a definição antiga e remove tudo', async () => {
  const db = await setup();
  await db.exec(read(MIG + FWD));
  await db.exec(read(MIG + 'rollback/' + FWD));
  assert.equal(await recebe(db), null);
  assert.equal((await one(db, `SELECT to_regclass('public.whatsapp_numero_lead_escolhido') AS t`)).t, null);
  assert.equal((await one(db, `SELECT to_regprocedure('public.escolher_lead_do_numero(uuid, text, uuid)') AS f`)).f, null);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('leads_vivos_do_numero','ultimo_lead_vinculado_ao_numero','lead_do_numero_ambiguo','vinculo_de_lead_tem_efeito_externo')`)).n, 0);
});
