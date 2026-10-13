-- tests/fixtures/lead-owners-schema.sql
--
-- Minimal slice of the prod schema that `leads` RLS and the lead_owners
-- migration (Chamado 793f4b05 · PR1) depend on. Used ONLY by local, disposable
-- clusters: scripts/test-lead-owners-db.mjs (plain PostgreSQL 16, no Docker)
-- and the pgTAP run in a throwaway supabase/postgres container.
--
-- Everything below that is not a bare table is copied LITERALLY from prod
-- (2026-10-09, pg_get_functiondef / pg_policies / pg_get_triggerdef):
--   functions  get_my_gestor_organization_ids, get_my_member_organization_ids,
--              org_access_blocked, get_my_organization_ids,
--              get_user_organization_id, is_master_user, is_user_admin,
--              has_role, has_feature_permission (1 and 2 args),
--              user_has_org_permission, assert_org_access,
--              fn_sync_canonical_assignment, fn_assert_member_same_org
--   policies   the 6 policies of public.leads
--   triggers   trg_leads_sync_canonical_assignment,
--              trg_assert_member_same_org_leads
-- (bodies literal; only SQL comments were trimmed in org_access_blocked,
-- assert_org_access and fn_assert_member_same_org).
-- The 4 rls_* helpers come from supabase/migrations/20271107150000 (identical
-- to prod: same policy text in pg_policies). Tables carry only the columns
-- these objects read. Never apply this file to a real project.

-- ---------------------------------------------------------------------------
-- Roles and the auth surface (present in the supabase image; created here on
-- a plain cluster).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $b$
        SELECT nullif(coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        ), '')::uuid
      $b$
    $f$;
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $b$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim.role', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
        )
      $b$
    $f$;
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, email text, encrypted_password text,
      email_confirmed_at timestamptz, raw_user_meta_data jsonb,
      created_at timestamptz, updated_at timestamptz, instance_id uuid,
      aud text, role text, confirmation_token text, recovery_token text,
      email_change_token_new text, email_change_token_current text,
      reauthentication_token text, phone_change_token text,
      email_change text, phone_change text
    );
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables (only the columns used)
-- ---------------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('admin','sdr','closer','agency','bdr','cliente','member');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  slug text,
  timezone text,
  subscription_status text NOT NULL DEFAULT 'trial',
  billing_override boolean DEFAULT false,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  user_id uuid,
  name text NOT NULL,
  role public.app_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.master_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_active boolean DEFAULT true
);

CREATE TABLE public.gestores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.gestor_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id uuid NOT NULL,
  organization_id uuid NOT NULL
);

CREATE TABLE public.feature_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  module text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  default_value boolean NOT NULL DEFAULT true,
  is_admin_only boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);

-- Same catalog defaults as prod.
INSERT INTO public.feature_permissions (key, module, name, description, default_value, is_admin_only) VALUES
  ('leads.view_all',          'Leads', 'Ver todos',        'x', true, false),
  ('leads.view_unassigned',   'Leads', 'Ver sem dono',     'x', true, false),
  ('leads.view_subordinates', 'Leads', 'Ver subordinados', 'x', true, false);

CREATE TABLE public.member_feature_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_feature_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  feature_key text NOT NULL,
  enabled boolean NOT NULL
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  name text,
  origin text,
  phone text,
  pre_sale_responsible_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  sale_responsible_id     uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  sdr_id                  uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  closer_id               uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  responsible_id          uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  responsible_user_id     uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  claimed_by              uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pipeline_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.upsell_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id uuid,
  name text,
  cnpj text,
  external_source text,
  external_id text,
  updated_at timestamptz DEFAULT now()
);

-- authenticated holds full DML on leads in prod; RLS restricts it.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authorization functions — literal prod copies
-- ---------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.get_user_organization_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY created_at ASC, id ASC
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.is_user_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.has_feature_permission(p_feature_key text, p_org_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_feature_permission(
    p_feature_key,
    public.get_user_organization_id()
  )
$function$;

CREATE OR REPLACE FUNCTION public.user_has_org_permission(p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.assert_org_access(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- backend (service_role) e jobs internos passam
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;

  -- master vê qualquer org
  IF public.is_master_user() THEN RETURN; END IF;

  -- org nula nunca concede acesso
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_my_organization_ids() AS t(org_id)
    WHERE t.org_id = p_org_id
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
END;
$function$;

-- ---------------------------------------------------------------------------
-- rls_* helpers — supabase/migrations/20271107150000 (same text as prod)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rls_my_team_member_ids(p_active_only boolean)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT tm.id
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND (p_active_only IS FALSE OR tm.is_active)
    ORDER BY tm.id
  )
$function$;

CREATE FUNCTION public.rls_my_same_org_team_member_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT tm_resp.id
    FROM public.team_members tm_resp
    WHERE tm_resp.organization_id IN (
      SELECT tm_user.organization_id
      FROM public.team_members tm_user
      WHERE tm_user.user_id = auth.uid()
    )
      AND EXISTS (
        SELECT 1
        FROM public.leads l
        WHERE l.deleted_at IS NULL
          AND l.organization_id IN (SELECT public.get_my_organization_ids())
          AND (l.sdr_id = tm_resp.id OR l.closer_id = tm_resp.id)
      )
    ORDER BY tm_resp.id
  )
$function$;

CREATE FUNCTION public.rls_my_orgs_with_feature(p_feature_key text)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT o.org_id
    FROM public.get_my_organization_ids() AS o(org_id)
    WHERE public.has_feature_permission(p_feature_key, o.org_id)
    ORDER BY o.org_id
  )
$function$;

CREATE FUNCTION public.rls_lead_in_my_pipes(p_lead_id uuid, p_tm_ids uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.pipeline_entries pe
    CROSS JOIN LATERAL (
      VALUES
        (pe.assigned_to),
        ((pe.metadata->>'sdr_id')::uuid),
        ((pe.metadata->>'responsible_id')::uuid),
        ((pe.metadata->>'closer_id')::uuid),
        ((pe.metadata->>'pre_sale_responsible_id')::uuid),
        ((pe.metadata->>'sale_responsible_id')::uuid)
    ) AS k(tm_id)
    WHERE pe.lead_id = p_lead_id
      AND k.tm_id = ANY (p_tm_ids)
      AND EXISTS (
        SELECT 1
        FROM public.team_members tm
        WHERE tm.id = k.tm_id
          AND tm.user_id = auth.uid()
          AND tm.is_active = true
      )
  )
$function$;

-- ---------------------------------------------------------------------------
-- Triggers on leads that matter for ownership — literal prod copies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_canonical_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.pre_sale_responsible_id IS NULL THEN NEW.pre_sale_responsible_id := NEW.sdr_id; END IF;
    IF NEW.sdr_id IS NULL THEN NEW.sdr_id := NEW.pre_sale_responsible_id; END IF;
    IF NEW.sale_responsible_id IS NULL THEN NEW.sale_responsible_id := COALESCE(NEW.closer_id, NEW.responsible_id); END IF;
    IF NEW.closer_id IS NULL THEN NEW.closer_id := NEW.sale_responsible_id; END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: espelha só o lado que mudou; quem foi tocado explicitamente vence.
  IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id
     AND NEW.pre_sale_responsible_id IS NOT DISTINCT FROM OLD.pre_sale_responsible_id THEN
    NEW.pre_sale_responsible_id := NEW.sdr_id;
  ELSIF NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id
     AND NEW.sdr_id IS NOT DISTINCT FROM OLD.sdr_id THEN
    NEW.sdr_id := NEW.pre_sale_responsible_id;
  END IF;

  IF NEW.closer_id IS DISTINCT FROM OLD.closer_id
     AND NEW.sale_responsible_id IS NOT DISTINCT FROM OLD.sale_responsible_id THEN
    NEW.sale_responsible_id := NEW.closer_id;
  ELSIF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id
     AND NEW.closer_id IS NOT DISTINCT FROM OLD.closer_id
     AND NEW.sale_responsible_id IS NOT DISTINCT FROM OLD.sale_responsible_id THEN
    NEW.sale_responsible_id := COALESCE(NEW.closer_id, NEW.responsible_id);
  ELSIF NEW.sale_responsible_id IS DISTINCT FROM OLD.sale_responsible_id
     AND NEW.closer_id IS NOT DISTINCT FROM OLD.closer_id THEN
    NEW.closer_id := NEW.sale_responsible_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_assert_member_same_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_bad uuid;
  v_bad_col text;
BEGIN
  SELECT m.id, k.col INTO v_bad, v_bad_col
  FROM unnest(ARRAY[
         'responsible_id', 'sdr_id', 'closer_id',
         'pre_sale_responsible_id', 'sale_responsible_id', 'assigned_to',
         'responsible_user_id',
         'claimed_by'
       ]) AS k(col)
  JOIN public.team_members m
    ON m.id = (v_row ->> k.col)::uuid
  WHERE m.organization_id <> (v_row ->> 'organization_id')::uuid
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'access_denied: % aponta para team_member % de outra organização', v_bad_col, v_bad
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_leads_sync_canonical_assignment BEFORE INSERT OR UPDATE OF sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id ON public.leads FOR EACH ROW EXECUTE FUNCTION fn_sync_canonical_assignment();
CREATE TRIGGER trg_assert_member_same_org_leads BEFORE INSERT OR UPDATE OF responsible_id, sdr_id, closer_id, pre_sale_responsible_id, sale_responsible_id, responsible_user_id, claimed_by ON public.leads FOR EACH ROW EXECUTE FUNCTION fn_assert_member_same_org();

-- ---------------------------------------------------------------------------
-- RLS of leads — the 6 policies, literal from pg_policies (prod)
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_delete_admin_or_permission ON public.leads FOR DELETE TO public
USING ((deleted_at IS NULL) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT is_master_user() AS is_master_user) OR ( SELECT user_has_org_permission('can_delete_leads'::text) AS user_has_org_permission)));

CREATE POLICY leads_insert_organization ON public.leads FOR INSERT TO public
WITH CHECK (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids));

CREATE POLICY leads_select_by_responsibility_and_permissions ON public.leads FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR (organization_id IN ( SELECT get_my_gestor_organization_ids() AS get_my_gestor_organization_ids)) OR ( SELECT has_feature_permission('leads.view_all'::text) AS has_feature_permission) OR (organization_id = ANY (( SELECT rls_my_orgs_with_feature('leads.view_all'::text) AS rls_my_orgs_with_feature)::uuid[])) OR (pre_sale_responsible_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR (sale_responsible_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR (sdr_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR (closer_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR ((sdr_id IS NULL) AND (closer_id IS NULL) AND ( SELECT user_has_org_permission('see_unassigned_cards'::text) AS user_has_org_permission)) OR (( SELECT user_has_org_permission('see_subordinates_cards'::text) AS user_has_org_permission) AND ((sdr_id = ANY (( SELECT rls_my_same_org_team_member_ids() AS rls_my_same_org_team_member_ids)::uuid[])) OR (closer_id = ANY (( SELECT rls_my_same_org_team_member_ids() AS rls_my_same_org_team_member_ids)::uuid[])))) OR ((cardinality(( SELECT rls_my_team_member_ids(true) AS rls_my_team_member_ids)) > 0) AND rls_lead_in_my_pipes(id, ( SELECT rls_my_team_member_ids(true) AS rls_my_team_member_ids)))));

CREATE POLICY leads_update_by_responsibility_and_permissions ON public.leads FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT has_feature_permission('leads.view_all'::text) AS has_feature_permission) OR (organization_id = ANY (( SELECT rls_my_orgs_with_feature('leads.view_all'::text) AS rls_my_orgs_with_feature)::uuid[])) OR (pre_sale_responsible_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR (sale_responsible_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR (sdr_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR (closer_id = ANY (( SELECT rls_my_team_member_ids(false) AS rls_my_team_member_ids)::uuid[])) OR ((sdr_id IS NULL) AND (closer_id IS NULL) AND ( SELECT user_has_org_permission('see_unassigned_cards'::text) AS user_has_org_permission)) OR (( SELECT user_has_org_permission('see_subordinates_cards'::text) AS user_has_org_permission) AND ((sdr_id = ANY (( SELECT rls_my_same_org_team_member_ids() AS rls_my_same_org_team_member_ids)::uuid[])) OR (closer_id = ANY (( SELECT rls_my_same_org_team_member_ids() AS rls_my_same_org_team_member_ids)::uuid[])))) OR ((cardinality(( SELECT rls_my_team_member_ids(true) AS rls_my_team_member_ids)) > 0) AND rls_lead_in_my_pipes(id, ( SELECT rls_my_team_member_ids(true) AS rls_my_team_member_ids)))));

CREATE POLICY master_all_leads ON public.leads FOR ALL TO public
USING ((deleted_at IS NULL) AND ( SELECT is_master_user() AS is_master_user));

CREATE POLICY master_select_all_leads ON public.leads FOR SELECT TO public
USING ((deleted_at IS NULL) AND ( SELECT is_master_user() AS is_master_user));

-- Supabase's default privileges: every object created from here on (the
-- migrations under test) is granted to anon/authenticated/service_role BY
-- NAME, exactly as in prod. A REVOKE FROM PUBLIC alone does not undo these;
-- the migration must revoke by name, and the tests prove it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
