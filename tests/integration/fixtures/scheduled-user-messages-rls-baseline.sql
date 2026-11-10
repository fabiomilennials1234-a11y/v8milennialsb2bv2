-- Esqueleto mínimo de prod para scheduled_user_messages (lido em 10/11/2026).
-- Funções de que as policies dependem: corpo de PROD (pg_get_functiondef).
-- Policies INSERT/UPDATE/SELECT/master: texto de pg_policies em prod.
-- Fora do esqueleto: strict_owner_related_select (RESTRICTIVE, só SELECT; não
-- muda nesta migration) e colunas de tabelas vizinhas que a migration não lê.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  subscription_status text NOT NULL DEFAULT 'active',
  billing_override boolean DEFAULT false
);
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY,
  user_id uuid,
  organization_id uuid REFERENCES public.organizations(id),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.gestores (id uuid PRIMARY KEY, user_id uuid, is_active boolean DEFAULT true);
CREATE TABLE public.gestor_organizations (gestor_id uuid, organization_id uuid);
CREATE TABLE public.master_users (user_id uuid, is_active boolean DEFAULT true);
CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id));
CREATE TABLE public.whatsapp_instances (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id));

CREATE TABLE public.scheduled_user_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.team_members(id),
  whatsapp_instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  message_content text,
  media_url text,
  media_type text,
  media_filename text,
  scheduled_at timestamptz NOT NULL,
  status text DEFAULT 'scheduled' NOT NULL,
  sent_at timestamptz,
  error_message text,
  retry_count integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  assigned_to uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  CONSTRAINT content_or_media CHECK (message_content IS NOT NULL OR media_url IS NOT NULL),
  CONSTRAINT scheduled_user_messages_status_check CHECK (status = ANY (ARRAY['scheduled','sending','sent','failed','cancelled']))
);

-- ---- funções de prod (corpo verbatim) ----
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

CREATE OR REPLACE FUNCTION public.my_team_member_id(p_organization_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tm.id
  FROM public.team_members tm
  WHERE tm.user_id         = auth.uid()
    AND tm.organization_id = p_organization_id
    AND tm.is_active       = true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.default_assigned_to_scheduled_msg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER trg_default_assigned_to_scheduled_msg BEFORE INSERT OR UPDATE ON public.scheduled_user_messages
  FOR EACH ROW EXECUTE FUNCTION public.default_assigned_to_scheduled_msg();

-- ---- RLS ----
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_select_own ON public.team_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY team_members_select_organization ON public.team_members FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY wi_select ON public.whatsapp_instances FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY wi_delete ON public.whatsapp_instances FOR DELETE
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_select ON public.leads FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

ALTER TABLE public.scheduled_user_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can insert own org scheduled messages" ON public.scheduled_user_messages FOR INSERT
  WITH CHECK (organization_id IN ( SELECT team_members.organization_id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY "Members can update own scheduled messages" ON public.scheduled_user_messages FOR UPDATE
  USING (created_by IN ( SELECT team_members.id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY "Members can view own org scheduled messages" ON public.scheduled_user_messages FOR SELECT
  USING (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids));
CREATE POLICY master_ghost_all_scheduled_user_messages ON public.scheduled_user_messages
  USING (( SELECT is_master_user() AS is_master_user)) WITH CHECK (( SELECT is_master_user() AS is_master_user));
CREATE POLICY master_ghost_select_scheduled_user_messages ON public.scheduled_user_messages FOR SELECT
  USING (( SELECT is_master_user() AS is_master_user));

-- ---- grants como em prod (baseline:45737-45739) ----
GRANT SELECT ON public.scheduled_user_messages TO anon;
GRANT ALL ON public.scheduled_user_messages TO authenticated, service_role;
GRANT SELECT ON public.team_members, public.leads, public.organizations TO authenticated;
GRANT SELECT, DELETE ON public.whatsapp_instances TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
