-- Estado de PROD (jsjsmuncfkbsbzqzqhfq) em 23/10/2026 para o teste PGlite de
-- 20271215000001_policies_admin_global_ganham_escopo_de_org.sql.
-- Policies das 4 tabelas, helpers de papel/org e trigger de espelho: texto de
-- prod verbatim (pg_get_expr / pg_get_functiondef / pg_get_triggerdef).
-- Tabelas: só as colunas que as policies e o teste usam. Gerado, não editar.

CREATE TYPE public.app_role AS ENUM ('admin','sdr','closer','agency','bdr','cliente','member');
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;
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
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM public.get_my_member_organization_ids() AS m(org_id)
  WHERE NOT public.org_access_blocked(m.org_id);
$function$
;
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
$function$
;
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
$function$
;

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
CREATE OR REPLACE FUNCTION public.sync_user_roles_from_team_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só sincroniza se tem user_id
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Se o membro foi desativado, remover a role antiga (se não tiver outro team_member ativo com essa role)
  IF NEW.is_active = false AND (TG_OP = 'UPDATE' AND OLD.is_active = true) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = NEW.user_id
        AND role = OLD.role
        AND is_active = true
        AND id != NEW.id
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = NEW.user_id AND role = OLD.role;
    END IF;
    RETURN NEW;
  END IF;

  -- Se role mudou em UPDATE, remover a role antiga (se não tiver outro team_member ativo com ela)
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = NEW.user_id
        AND role = OLD.role
        AND is_active = true
        AND id != NEW.id
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = NEW.user_id AND role = OLD.role;
    END IF;
  END IF;

  -- Upsert da nova role (INSERT ou UPDATE com nova role)
  IF NEW.is_active = true AND NEW.role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, NEW.role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM (
    SELECT organization_id AS org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    UNION
    SELECT * FROM public.get_my_gestor_organization_ids()
  ) AS m
  WHERE NOT public.org_access_blocked(m.org_id);
$function$;
CREATE OR REPLACE FUNCTION public.get_my_team_member_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
    AND NOT public.org_access_blocked(organization_id);
$function$;
CREATE OR REPLACE FUNCTION public.get_org_team_member_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT id FROM public.team_members
  WHERE organization_id IN (SELECT public.get_my_organization_ids())
$function$;
CREATE TRIGGER trg_sync_user_roles AFTER INSERT OR UPDATE OF role, is_active, user_id ON public.team_members FOR EACH ROW EXECUTE FUNCTION sync_user_roles_from_team_members();

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipe_dispatch_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Apenas admins podem gerenciar comissões" ON public.commissions AS PERMISSIVE FOR ALL TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Usuários podem ver próprias comissões" ON public.commissions AS PERMISSIVE FOR SELECT TO public USING ((has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR (team_member_id IN ( SELECT get_my_team_member_ids() AS get_my_team_member_ids))));
CREATE POLICY commissions_select_org ON public.commissions AS PERMISSIVE FOR SELECT TO public USING (((team_member_id IN ( SELECT get_my_team_member_ids() AS get_my_team_member_ids)) OR (team_member_id IN ( SELECT get_org_team_member_ids() AS get_org_team_member_ids))));
CREATE POLICY master_all_commissions ON public.commissions AS PERMISSIVE FOR ALL TO public USING (( SELECT is_master_user() AS is_master_user));
CREATE POLICY master_select_all_commissions ON public.commissions AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_master_user() AS is_master_user));
CREATE POLICY "Apenas admins podem gerenciar automações" ON public.follow_up_automations AS PERMISSIVE FOR ALL TO public USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY follow_up_automations_select_org ON public.follow_up_automations AS PERMISSIVE FOR SELECT TO authenticated USING ((organization_id = ( SELECT get_user_organization_id() AS get_user_organization_id)));
CREATE POLICY master_ghost_all_follow_up_automations ON public.follow_up_automations AS PERMISSIVE FOR ALL TO public USING (( SELECT is_master_user() AS is_master_user)) WITH CHECK (( SELECT is_master_user() AS is_master_user));
CREATE POLICY master_ghost_select_follow_up_automations ON public.follow_up_automations AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_master_user() AS is_master_user));
CREATE POLICY master_ghost_all_pipe_dispatch_rules ON public.pipe_dispatch_rules AS PERMISSIVE FOR ALL TO public USING (( SELECT is_master_user() AS is_master_user)) WITH CHECK (( SELECT is_master_user() AS is_master_user));
CREATE POLICY master_ghost_select_pipe_dispatch_rules ON public.pipe_dispatch_rules AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_master_user() AS is_master_user));
CREATE POLICY pipe_dispatch_rules_delete ON public.pipe_dispatch_rules AS PERMISSIVE FOR DELETE TO authenticated USING ((organization_id IN ( SELECT team_members.organization_id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY pipe_dispatch_rules_insert ON public.pipe_dispatch_rules AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((organization_id IN ( SELECT team_members.organization_id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_user_admin() AS is_user_admin)));
CREATE POLICY pipe_dispatch_rules_select ON public.pipe_dispatch_rules AS PERMISSIVE FOR SELECT TO authenticated USING ((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)));
CREATE POLICY pipe_dispatch_rules_update ON public.pipe_dispatch_rules AS PERMISSIVE FOR UPDATE TO authenticated USING ((organization_id IN ( SELECT team_members.organization_id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((organization_id IN ( SELECT team_members.organization_id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Apenas admins podem deletar roles" ON public.user_roles AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role));
CREATE POLICY "Apenas admins podem inserir roles" ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role));
CREATE POLICY master_all_user_roles ON public.user_roles AS PERMISSIVE FOR ALL TO public USING (( SELECT is_master_user() AS is_master_user));
CREATE POLICY master_select_all_user_roles ON public.user_roles AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_master_user() AS is_master_user));
CREATE POLICY user_roles_select_org_admin ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated USING ((is_master_user() OR (user_id IN ( SELECT tm.user_id
   FROM team_members tm
  WHERE (tm.organization_id IN ( SELECT get_my_admin_organization_ids() AS get_my_admin_organization_ids))))));
CREATE POLICY user_roles_select_self ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
