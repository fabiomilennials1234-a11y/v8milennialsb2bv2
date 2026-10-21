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
