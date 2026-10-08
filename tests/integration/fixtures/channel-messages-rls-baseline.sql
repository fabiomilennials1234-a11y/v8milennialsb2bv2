-- Skeleton copied from PROD (jsjsmuncfkbsbzqzqhfq) on 2026-10-06 for
-- tests/integration/channel-messages-restrict-owner.test.mjs.
-- Tables: only the columns the policies/functions read. Functions: verbatim
-- pg_get_functiondef bodies (md5 pinned in the test). Policies: verbatim
-- pg_policies text of channel_messages before 20271107160000.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Supabase default privileges (functions created in public/private get EXECUTE by name)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin','sdr','closer','agency','bdr','cliente','member');

CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL DEFAULT 'x', subscription_status text,
  billing_override boolean, chat_restrict_to_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, role public.app_role NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true, organization_id uuid);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.master_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean);
CREATE TABLE public.gestores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.gestor_organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gestor_id uuid NOT NULL, organization_id uuid NOT NULL);
CREATE TABLE public.member_feature_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_member_id uuid NOT NULL,
  feature_key text NOT NULL, enabled boolean NOT NULL);
CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, deleted_at timestamptz,
  normalized_phone text, pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid);
CREATE TABLE public.channel_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  instance_id uuid, lead_id uuid, phone_number text, content text);
CREATE INDEX idx_channel_messages_org ON public.channel_messages(organization_id);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;
-- prod: authenticated has SELECT only on channel_messages; anon has nothing.
GRANT SELECT ON public.channel_messages TO authenticated;
GRANT ALL ON public.channel_messages TO service_role;
-- The RESTRICTIVE box policy reads team_members inline, as the caller. Prod has
-- several SELECT policies there; the caller's own rows are all it needs.
GRANT SELECT ON public.team_members TO authenticated;
CREATE POLICY tm_self_fixture ON public.team_members FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---- prod functions, verbatim ----
CREATE OR REPLACE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = _user_id
    AND is_active = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_gestor_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT go.organization_id
  FROM public.gestor_organizations go
  JOIN public.gestores g ON g.id = go.gestor_id
  WHERE g.user_id = auth.uid()
    AND g.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_member_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$function$;

CREATE OR REPLACE FUNCTION public.org_access_blocked(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT o.subscription_status IN ('suspended', 'cancelled', 'expired')
             AND NOT COALESCE(o.billing_override, false)
      FROM public.organizations o
      WHERE o.id = p_org_id
    ),
    -- org inexistente: não é "bloqueada", é inexistente. Quem chama já trata
    -- ausência de vínculo; devolver true aqui só embaralharia os dois casos.
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM public.get_my_member_organization_ids() AS m(org_id)
  WHERE NOT public.org_access_blocked(m.org_id);
$function$;

CREATE OR REPLACE FUNCTION public.normalize_brazilian_phone(phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cleaned TEXT;
BEGIN
  -- Se nulo ou vazio, retornar nulo
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;

  -- Remove tudo que não é dígito
  cleaned := regexp_replace(phone, '\D', '', 'g');

  -- Se vazio após limpeza, retornar nulo
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- Remover prefixo internacional +55 ou 55 se presente (12+ dígitos)
  IF length(cleaned) >= 12 AND left(cleaned, 2) = '55' THEN
    cleaned := substring(cleaned from 3);
  END IF;

  -- Adicionar 9 se número celular de 8 dígitos (DDD + 8 dígitos = 10 dígitos)
  -- Celulares brasileiros: DDD(2) + 9(1) + número(8) = 11 dígitos
  IF length(cleaned) = 10 THEN
    -- Inserir 9 após o DDD
    cleaned := left(cleaned, 2) || '9' || substring(cleaned from 3);
  END IF;

  -- Formato final: 11 dígitos (DDD + 9 + 8 dígitos) para celular brasileiro
  -- Ou 10 dígitos para fixo (DDD + 8 dígitos)
  RETURN cleaned;
END;
$function$;

CREATE OR REPLACE FUNCTION private.chat_scope_for_recipient(p_user_id uuid, p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_member_id uuid;
  v_restricted     boolean;
BEGIN
  IF public.is_master_user(p_user_id) THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO v_team_member_id
  FROM public.team_members
  WHERE user_id = p_user_id
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin') OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND role = 'admin' AND is_active) THEN RETURN true; END IF;

  SELECT chat_restrict_to_owner INTO v_restricted
  FROM public.organizations WHERE id = p_org_id;

  -- Politica desligada: comportamento identico ao de antes.
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;

  -- Excecao nominal: com a politica ligada o default_value do catalogo GLOBAL
  -- deixa de valer, so override EXPLICITO abre.
  IF EXISTS (
    SELECT 1 FROM public.member_feature_permissions
    WHERE team_member_id = v_team_member_id
      AND feature_key = 'leads.view_all'
      AND enabled
  ) THEN
    RETURN true;
  END IF;

  IF p_lead_id IS NULL AND p_normalized_phone IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND (
        (p_lead_id IS NOT NULL AND l.id = p_lead_id)
        OR (p_lead_id IS NULL AND l.normalized_phone = p_normalized_phone)
      )
      AND (
        COALESCE(
          v_team_member_id IN (
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ), false)
        OR (
          COALESCE(
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions
            WHERE team_member_id = v_team_member_id
              AND feature_key = 'leads.view_unassigned'
              AND enabled
          )
        )
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone);
$function$;

-- STUB (not prod): the real one expands readable WhatsApp boxes. The RESTRICTIVE
-- policy that calls it is untouched by the migration; the stub keeps it in the
-- pipeline so the test proves the fix composes with it (rows with instance_id
-- set stay hidden from non-admins before AND after).
CREATE FUNCTION private.whatsapp_readable_message_instance_ids() RETURNS uuid[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT ARRAY[]::uuid[] $$;

-- prod ACLs
REVOKE ALL ON FUNCTION private.chat_scope_for_recipient(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_see_chat_scope(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.whatsapp_readable_message_instance_ids() FROM PUBLIC, anon, service_role;

-- ---- prod policies on channel_messages (pg_policies, 2026-10-06) ----
CREATE POLICY channel_messages_instance_read_access ON public.channel_messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((( SELECT is_master_user() AS is_master_user) OR (organization_id IN ( SELECT tm.organization_id
   FROM team_members tm
  WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND tm.is_active AND (tm.role = 'admin'::app_role)))) OR (instance_id IS NULL) OR (instance_id = ANY (( SELECT private.whatsapp_readable_message_instance_ids() AS whatsapp_readable_message_instance_ids)::uuid[]))));
CREATE POLICY channel_messages_org_access ON public.channel_messages AS PERMISSIVE FOR SELECT TO public
  USING ((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)));
CREATE POLICY channel_messages_select_by_owner ON public.channel_messages AS PERMISSIVE FOR SELECT TO public
  USING (((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND can_see_chat_scope(organization_id, lead_id, normalize_brazilian_phone(phone_number))));
CREATE POLICY channel_messages_service_role ON public.channel_messages AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT auth.role() AS role) = 'service_role'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'service_role'::text));
CREATE POLICY master_all_channel_messages ON public.channel_messages AS PERMISSIVE FOR ALL TO public
  USING (( SELECT is_master_user() AS is_master_user));
