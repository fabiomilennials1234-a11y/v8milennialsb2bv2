-- Fixture mínima para aplicar 20271212000000_cobranca_fundacao.sql num PGlite.
--
-- Só o que a migration referencia de fora: organizations, team_members,
-- titulos_receber, feature_permissions e os helpers de identidade/permissão.
-- Os helpers são RÉPLICAS ENXUTAS do que existe em prod (has_feature_permission
-- segue a mesma ordem: master > membro > admin > admin_only > override >
-- catálogo). A fidelidade de RLS/GRANT real é do pgTAP
-- (supabase/tests/cobranca_fundacao_test.sql); aqui se prova a LÓGICA das RPCs.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'authenticated')
$$;

CREATE TABLE public.organizations (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  slug          text,
  timezone      text NOT NULL DEFAULT 'America/Sao_Paulo',
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.team_members (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  user_id         uuid,
  name            text NOT NULL,
  role            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true
);

-- Em prod authenticated lê team_members (a RLS de lá recorta pela org).
GRANT SELECT ON public.team_members TO authenticated;

CREATE TABLE public.titulos_receber (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
);

CREATE TABLE public.feature_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,
  module        text NOT NULL,
  name          text NOT NULL,
  description   text NOT NULL,
  is_admin_only boolean NOT NULL DEFAULT false,
  default_value boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.master_users (user_id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.organization_feature_defaults (organization_id uuid, feature_key text, enabled boolean);
CREATE TABLE public.member_feature_permissions (team_member_id uuid, feature_key text, enabled boolean);

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE FUNCTION public.is_master_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.master_users WHERE user_id = auth.uid() AND is_active)
$$;

-- Réplica de prod (20270825000000_is_org_admin_helper.sql).
CREATE FUNCTION public.is_org_admin(p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.is_master_user(), false)
      OR EXISTS (SELECT 1 FROM public.team_members tm
                  WHERE tm.user_id = auth.uid() AND tm.organization_id = p_organization_id
                    AND tm.is_active AND tm.role = 'admin')
$$;

CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.team_members WHERE user_id = auth.uid() AND is_active
$$;

CREATE FUNCTION public.assert_org_access(p_org_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_master_user() THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members
                  WHERE user_id = auth.uid() AND organization_id = p_org_id AND is_active) THEN
    RAISE EXCEPTION 'Acesso negado à organização' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION public.has_feature_permission(p_feature_key text, p_org_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tm uuid; v_admin boolean; v_admin_only boolean; v_default boolean; v_enabled boolean;
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;
  SELECT id, role = 'admin' INTO v_tm, v_admin FROM public.team_members
   WHERE user_id = auth.uid() AND organization_id = p_org_id AND is_active LIMIT 1;
  IF v_tm IS NULL THEN RETURN false; END IF;
  IF v_admin THEN RETURN true; END IF;
  SELECT is_admin_only, default_value INTO v_admin_only, v_default
    FROM public.feature_permissions WHERE key = p_feature_key;
  IF NOT FOUND OR v_admin_only THEN RETURN false; END IF;
  SELECT enabled INTO v_enabled FROM public.member_feature_permissions
   WHERE team_member_id = v_tm AND feature_key = p_feature_key;
  RETURN COALESCE(v_enabled, v_default, false);
END $$;

-- ── Entrega 2 (régua): o que a migration toca fora da cobrança ──────────────
CREATE FUNCTION public.normalize_br_mobile(digits text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN length(digits) = 13 AND left(digits, 2) = '55' THEN digits
    WHEN length(digits) = 12 AND left(digits, 2) = '55' THEN left(digits, 4) || '9' || substr(digits, 5)
    WHEN length(digits) = 11 AND substr(digits, 3, 1) = '9' THEN '55' || digits
    WHEN length(digits) = 10 THEN '55' || left(digits, 2) || '9' || substr(digits, 3)
    ELSE digits
  END;
$$;

CREATE TABLE public.whatsapp_instances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id),
  instance_name    text,
  phone_number     text,
  provider         text NOT NULL DEFAULT 'uazapi',
  status           text NOT NULL DEFAULT 'connected',
  copilot_agent_id uuid,
  owner_team_member_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.copilot_agents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  name                 text,
  whatsapp_instance_id uuid
);

CREATE TABLE public.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  phone_digits    text NOT NULL DEFAULT ''
);

CREATE TABLE public.whatsapp_messages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  instance_id            uuid,
  message_id             text,
  phone_number           text,
  direction              text,
  message_type           text DEFAULT 'text',
  content                text,
  lead_id                uuid,
  is_group               boolean DEFAULT false,
  sent_source            text,
  sent_by_team_member_id uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_messages_sent_source_check
    CHECK (sent_source = ANY (ARRAY['manual'::text, 'copilot'::text, 'workflow'::text]))
);

-- Versão mínima do vínculo por telefone de prod: o que importa aqui é ele
-- rodar ANTES do isolamento da cobrança (ordem alfabética dos BEFORE).
CREATE FUNCTION public.resolve_message_lead_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN
    SELECT l.id INTO NEW.lead_id FROM public.leads l
     WHERE l.organization_id = NEW.organization_id
       AND l.phone_digits = regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g')
     LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_resolve_message_lead_id BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.resolve_message_lead_id();

-- Resolução de instância do webhook, como em prod (20271107100000): a régua a
-- redefine para devolver reserved_for.
CREATE TABLE public.whatsapp_instance_secrets (
  instance_id        uuid PRIMARY KEY REFERENCES public.whatsapp_instances(id),
  uazapi_instance_id text,
  uazapi_token       text
);
CREATE OR REPLACE FUNCTION public.resolve_uazapi_instance(
  p_instance_ref text,
  p_token text
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  instance_name text,
  phone_number text,
  provider text,
  via text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_via text;
BEGIN
  -- Guarda: só service_role (mesmo padrão de get_uazapi_credentials).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_instance_ref IS NOT NULL AND p_instance_ref <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_instance_id = p_instance_ref;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'instance_id';
    END IF;
  END IF;

  IF v_id IS NULL AND p_token IS NOT NULL AND p_token <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_token = p_token;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'token';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT i.id, i.organization_id, i.instance_name, i.phone_number, i.provider, v_via
    FROM public.whatsapp_instances i
   WHERE i.id = v_id;
END;
$function$;

-- Default privileges do Supabase: toda relação, sequence e função NOVA em public
-- nasce com ALL para anon e authenticated. Sem isto o PGlite aprovava ACL que o
-- banco real reprova (views e sequence da cobrança, medido em prod em 22/10).
-- Fica no fim: só o que a migration cria herda, como em prod.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
