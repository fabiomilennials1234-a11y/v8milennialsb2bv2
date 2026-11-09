CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claim.role', true);
$$;
CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, deleted_at timestamptz);
CREATE TABLE test_permissions(user_id uuid, organization_id uuid, can_update boolean, can_address boolean);
-- Dependencies of the actual address gate. The tests vary each permission
-- independently; the three address functions under review come from prod SQL.
CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM public.test_permissions WHERE user_id=auth.uid();
$$;
CREATE FUNCTION can_update_lead(p_lead uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce((SELECT p.can_update FROM public.test_permissions p JOIN public.leads l ON l.organization_id=p.organization_id
    WHERE p.user_id=auth.uid() AND l.id=p_lead),false);
$$;
CREATE FUNCTION has_feature_permission(p_key text,p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT p_key='leads.edit_address' AND coalesce((SELECT can_address FROM public.test_permissions
    WHERE user_id=auth.uid() AND organization_id=p_org),false);
$$;
CREATE TABLE lead_addresses(id uuid PRIMARY KEY, lead_id uuid REFERENCES leads(id), deleted_at timestamptz,
  latitude double precision, longitude double precision, geocode_status text DEFAULT 'failed',
  geocode_provider text, geocode_accuracy text, geocode_confidence numeric, geocoded_at timestamptz,
  geocode_claimed_until timestamptz, geocode_last_error text, updated_by uuid,
  geocode_attempts integer DEFAULT 5, geocode_next_attempt_at timestamptz);
CREATE TABLE lead_address_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), address_id uuid, lead_id uuid,
  organization_id uuid, action text, actor uuid, data jsonb);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
