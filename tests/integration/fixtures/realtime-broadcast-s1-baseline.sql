-- Skeleton copied from PROD (jsjsmuncfkbsbzqzqhfq) on 2026-10-19 for
-- tests/integration/realtime-broadcast-s1.test.mjs.
-- Tables: only the columns the migration reads (pipeline_entries: all prod
-- columns, the trigger serializes the row type). Functions: verbatim
-- pg_get_functiondef bodies (md5 pinned in the test). realtime.messages: prod
-- columns, RLS on, 0 policies, prod grants (anon/authenticated INSERT/SELECT/UPDATE).
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA realtime;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Supabase default privileges (functions created in public/private get EXECUTE by name)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin','sdr','closer','agency','bdr','cliente','member');

CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL DEFAULT 'x', subscription_status text,
  billing_override boolean, feature_flags jsonb DEFAULT '{}'::jsonb);
CREATE TABLE public.team_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true, organization_id uuid);
CREATE TABLE public.master_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean);
CREATE TABLE public.gestores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.gestor_organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gestor_id uuid NOT NULL, organization_id uuid NOT NULL);

CREATE TABLE public.pipeline_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  pipeline_id uuid,
  lead_id uuid,
  deal_id uuid,
  stage_key text,
  assigned_to uuid,
  notes text,
  metadata jsonb,
  entered_at timestamptz DEFAULT now(),
  stage_changed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  stage_id uuid
);
-- The app's BEFORE UPDATE trigger stamps updated_at on every write.
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER update_pipeline_entries_updated_at BEFORE UPDATE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- Skeleton RLS: the real policies are org-scoped; here the test only needs
-- authenticated to be able to write so the trigger runs as that role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_entries TO authenticated;

CREATE TABLE realtime.messages (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT timezone('utc'::text, clock_timestamp()),
  inserted_at timestamp without time zone NOT NULL DEFAULT timezone('utc'::text, clock_timestamp()),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  binary_payload bytea,
  skip_broadcast boolean NOT NULL DEFAULT false
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON realtime.messages TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION realtime.topic()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
select nullif(current_setting('realtime.topic', true), '')::text;
$function$;

CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION realtime.topic() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION realtime.send(jsonb, text, text, boolean) TO anon, authenticated, service_role;

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

CREATE OR REPLACE FUNCTION private.strict_lead_member_orgs()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ARRAY(
    SELECT o.id FROM public.organizations o
    WHERE o.feature_flags @> '{"strict_lead_owner_access":true}'::jsonb
      AND COALESCE(auth.role(), '') <> 'service_role'
      AND (auth.uid() IS NOT NULL OR COALESCE(auth.role(), '') IN ('authenticated', 'anon'))
      AND NOT COALESCE(public.is_master_user(), false)
      AND NOT EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.organization_id = o.id AND tm.user_id = auth.uid()
          AND tm.is_active AND tm.role = 'admin'
      )
  )
$function$;
