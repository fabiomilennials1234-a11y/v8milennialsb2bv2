-- Skeleton copied from PROD (jsjsmuncfkbsbzqzqhfq) on 2026-10-05/06 for
-- tests/integration/leads-rls-initplan-equivalence.test.mjs.
-- Tables: only the columns the policies/functions read. Functions: verbatim pg_get_functiondef.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase default privileges (functions created in public get EXECUTE by name)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin','sdr','closer','agency','bdr','cliente','member');

CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL DEFAULT 'x', subscription_status text, billing_override boolean);
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, name text NOT NULL DEFAULT 'tm', role public.app_role NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true, organization_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_team_members_user_id ON public.team_members(user_id);
CREATE INDEX idx_team_members_organization_id ON public.team_members(organization_id);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.master_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean);
CREATE TABLE public.gestores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.gestor_organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gestor_id uuid NOT NULL, organization_id uuid NOT NULL);
CREATE TABLE public.feature_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, is_admin_only boolean NOT NULL, default_value boolean NOT NULL);
CREATE TABLE public.member_feature_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_member_id uuid NOT NULL, organization_id uuid NOT NULL, feature_key text NOT NULL, enabled boolean NOT NULL);
CREATE TABLE public.organization_feature_defaults (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, feature_key text NOT NULL, enabled boolean NOT NULL);
CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT 'l', organization_id uuid, deleted_at timestamptz,
  pre_sale_responsible_id uuid, sale_responsible_id uuid, sdr_id uuid, closer_id uuid);
CREATE INDEX idx_leads_organization_id ON public.leads(organization_id);
CREATE INDEX idx_leads_pre_sale_responsible ON public.leads(pre_sale_responsible_id);
CREATE INDEX idx_leads_sale_responsible ON public.leads(sale_responsible_id);
CREATE INDEX idx_leads_sdr_id ON public.leads(sdr_id) WHERE sdr_id IS NOT NULL;
CREATE INDEX idx_leads_closer_id ON public.leads(closer_id) WHERE closer_id IS NOT NULL;
CREATE TABLE public.pipeline_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid, assigned_to uuid, metadata jsonb);
CREATE INDEX idx_pipeline_entries_lead ON public.pipeline_entries(lead_id) WHERE lead_id IS NOT NULL;

-- RLS on the helper tables (as prod: DEFINER functions are required to read them)
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_entries TO authenticated, service_role;

-- ---- prod functions, verbatim ----
CREATE OR REPLACE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid())
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = _user_id
    AND is_active = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.org_access_blocked(p_org_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.get_my_gestor_organization_ids()
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT go.organization_id
  FROM public.gestor_organizations go
  JOIN public.gestores g ON g.id = go.gestor_id
  WHERE g.user_id = auth.uid()
    AND g.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_member_organization_ids()
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM public.get_my_member_organization_ids() AS m(org_id)
  WHERE NOT public.org_access_blocked(m.org_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_user_organization_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY created_at ASC, id ASC
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.has_feature_permission(p_feature_key text, p_org_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_team_member_id UUID;
  v_is_admin       BOOLEAN;
  v_enabled        BOOLEAN;
  v_org_default    BOOLEAN;
  v_default        BOOLEAN;
  v_admin_only     BOOLEAN;
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;

  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id, (role = 'admin') INTO v_team_member_id, v_is_admin
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;
  IF v_is_admin THEN RETURN true; END IF;

  SELECT fp.is_admin_only, fp.default_value INTO v_admin_only, v_default
  FROM public.feature_permissions fp WHERE fp.key = p_feature_key;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_admin_only THEN RETURN false; END IF;

  -- 1) override individual
  SELECT mfp.enabled INTO v_enabled
  FROM public.member_feature_permissions mfp
  WHERE mfp.team_member_id = v_team_member_id
    AND mfp.feature_key = p_feature_key;

  IF v_enabled IS NOT NULL THEN RETURN v_enabled; END IF;

  -- 2) default da organizacao
  SELECT ofd.enabled INTO v_org_default
  FROM public.organization_feature_defaults ofd
  WHERE ofd.organization_id = p_org_id
    AND ofd.feature_key = p_feature_key;

  IF v_org_default IS NOT NULL THEN RETURN v_org_default; END IF;

  -- 3) catalogo global
  RETURN COALESCE(v_default, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_feature_permission(p_feature_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_feature_permission(
    p_feature_key,
    public.get_user_organization_id()
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_no_responsible(p_sdr_id uuid, p_closer_id uuid, p_assigned_to uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p_sdr_id IS NULL AND p_closer_id IS NULL AND p_assigned_to IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = _user_id AND role = _role AND is_active = true
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_responsible_in_same_org(p_sdr_id uuid, p_closer_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm_user
    JOIN public.team_members tm_resp ON tm_resp.organization_id = tm_user.organization_id
    WHERE tm_user.user_id = auth.uid()
      AND (tm_resp.id = p_sdr_id OR tm_resp.id = p_closer_id)
      AND tm_resp.id IS NOT NULL
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_user_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_user_responsible_in_any_pipe(p_lead_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tm_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_tm_ids
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;

  IF v_tm_ids IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.pipeline_entries pe
    WHERE pe.lead_id = p_lead_id
      AND (
        pe.assigned_to = ANY(v_tm_ids)
        OR (pe.metadata->>'sdr_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'responsible_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'closer_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'pre_sale_responsible_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'sale_responsible_id')::uuid = ANY(v_tm_ids)
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_user_responsible(p_sdr_id uuid, p_closer_id uuid, p_assigned_to uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
    AND (
      (p_sdr_id IS NOT NULL AND id = p_sdr_id)
      OR
      (p_closer_id IS NOT NULL AND id = p_closer_id)
    )
  )
  OR
  (p_assigned_to IS NOT NULL AND p_assigned_to = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.is_user_responsible(p_pre_sale uuid, p_sale uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND (
        (p_pre_sale IS NOT NULL AND id = p_pre_sale)
        OR
        (p_sale     IS NOT NULL AND id = p_sale)
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.user_has_org_permission(p_permission_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT true WHERE public.has_role(auth.uid(), 'admin')),
    (SELECT public.has_feature_permission(
      CASE p_permission_key
        WHEN 'see_unassigned_cards'   THEN 'leads.view_unassigned'
        WHEN 'see_subordinates_cards' THEN 'leads.view_subordinates'
        WHEN 'see_general_info'       THEN 'leads.view_general_info'
        WHEN 'see_all_leads'          THEN 'leads.view_all'
        WHEN 'can_delete_leads'       THEN 'leads.delete'
      END
    )),
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_see_lead_by_permissions(p_sdr_id uuid, p_closer_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    public.is_user_responsible(p_sdr_id, p_closer_id, NULL)
    OR (public.has_no_responsible(p_sdr_id, p_closer_id, NULL) AND public.user_has_org_permission('see_unassigned_cards'))
    OR (public.is_responsible_in_same_org(p_sdr_id, p_closer_id) AND public.user_has_org_permission('see_subordinates_cards'))
    OR public.has_feature_permission('leads.view_all')
$function$;

-- prod grants on has_feature_permission (authenticated + service_role only)
REVOKE ALL ON FUNCTION public.has_feature_permission(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_feature_permission(text) FROM PUBLIC, anon;

-- ---- prod policies on leads, verbatim (roles {public}) ----
CREATE POLICY "leads_select_by_responsibility_and_permissions" ON public.leads FOR SELECT
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR public.has_feature_permission('leads.view_all', organization_id)
    OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
    OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    OR public.is_user_responsible_in_any_pipe(id)
    OR organization_id IN (SELECT public.get_my_gestor_organization_ids())
  )
);
CREATE POLICY "leads_update_by_responsibility_and_permissions" ON public.leads FOR UPDATE
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR public.has_feature_permission('leads.view_all', organization_id)
    OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
    OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    OR public.is_user_responsible_in_any_pipe(id)
  )
);
CREATE POLICY master_select_all_leads ON public.leads FOR SELECT USING ((deleted_at IS NULL) AND (SELECT public.is_master_user()));
CREATE POLICY master_all_leads ON public.leads FOR ALL USING ((deleted_at IS NULL) AND (SELECT public.is_master_user()));
CREATE POLICY leads_insert_organization ON public.leads FOR INSERT WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY pipeline_entries_select ON public.pipeline_entries FOR SELECT USING (organization_id IN (SELECT public.get_my_organization_ids()));
