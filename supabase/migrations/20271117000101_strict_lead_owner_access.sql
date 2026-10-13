-- Opt-in enforcement. No organization is enabled by this schema migration.
-- Created by CLI on 2026-10-13; ordered after the repository's future-dated
-- baseline because lead_owners is a dependency (20271116000000).
-- Activation is an audited operation on organizations.feature_flags plus the
-- existing organization_feature_defaults and chat_restrict_to_owner settings.

CREATE OR REPLACE FUNCTION private.strict_lead_member_orgs()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- Internal boolean lookup: bypassing RLS avoids leads <-> pipeline recursion;
-- identity and active membership are checked explicitly, never user_metadata.
CREATE OR REPLACE FUNCTION private.strict_lead_is_owned(p_org uuid, p_lead uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.team_members tm ON tm.organization_id = l.organization_id
      AND tm.user_id = auth.uid() AND tm.is_active
    WHERE l.id = p_lead AND l.organization_id = p_org AND l.deleted_at IS NULL
      AND (
        tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)
        OR EXISTS (
          SELECT 1 FROM public.lead_owners own
          WHERE own.lead_id = l.id AND own.organization_id = p_org
            AND own.team_member_id = tm.id AND own.role = 'co'
        )
        OR EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.lead_id = l.id AND pe.organization_id = p_org
            AND (pe.assigned_to = tm.id OR tm.id::text IN (
              pe.metadata->>'pre_sale_responsible_id', pe.metadata->>'sale_responsible_id',
              pe.metadata->>'sdr_id', pe.metadata->>'closer_id', pe.metadata->>'responsible_id'
            ))
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.strict_lead_member_orgs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.strict_lead_is_owned(uuid, uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.strict_lead_member_orgs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.strict_lead_is_owned(uuid, uuid) TO authenticated, service_role;

-- Used only when opening a NEW deal for a lead already visible to the caller.
-- Accept self or an existing owner, never a new assignee.
CREATE FUNCTION private.strict_lead_owner_allowed(p_org uuid, p_lead uuid, p_member text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_member IS NULL OR EXISTS (
    SELECT 1 FROM public.team_members tm JOIN public.leads l ON l.organization_id=tm.organization_id
    WHERE tm.id::text=p_member AND tm.organization_id=p_org AND tm.is_active
      AND l.id=p_lead AND (
        tm.user_id=auth.uid()
        OR tm.id IN (l.pre_sale_responsible_id,l.sale_responsible_id,l.sdr_id,l.closer_id,l.responsible_id)
        OR EXISTS (SELECT 1 FROM public.lead_owners o WHERE o.lead_id=l.id AND o.organization_id=p_org AND o.team_member_id=tm.id)
        OR EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.lead_id=l.id AND pe.organization_id=p_org
          AND (pe.assigned_to=tm.id OR tm.id::text IN (pe.metadata->>'pre_sale_responsible_id',pe.metadata->>'sale_responsible_id',pe.metadata->>'sdr_id',pe.metadata->>'closer_id',pe.metadata->>'responsible_id')))
      )
  )
$$;
REVOKE ALL ON FUNCTION private.strict_lead_owner_allowed(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.strict_lead_owner_allowed(uuid,uuid,text) TO authenticated,service_role;

-- Restrictive policies intersect with existing tenant/plan policies. An admin
-- from another org, gestor, or per-member view_all override cannot widen this.
CREATE POLICY strict_owner_leads_select ON public.leads
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT (organization_id = ANY ((SELECT private.strict_lead_member_orgs())::uuid[]))
  OR private.strict_lead_is_owned(organization_id, id)
);
CREATE POLICY strict_owner_leads_update ON public.leads
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
  NOT (organization_id = ANY ((SELECT private.strict_lead_member_orgs())::uuid[]))
  OR private.strict_lead_is_owned(organization_id, id)
)
WITH CHECK (
  NOT (organization_id = ANY ((SELECT private.strict_lead_member_orgs())::uuid[]))
  OR private.strict_lead_is_owned(organization_id, id)
);
CREATE POLICY strict_owner_leads_delete ON public.leads
AS RESTRICTIVE FOR DELETE TO authenticated
USING (
  NOT (organization_id = ANY ((SELECT private.strict_lead_member_orgs())::uuid[]))
  OR private.strict_lead_is_owned(organization_id, id)
);

-- Protect the source as well as security_invoker projections and Realtime.
CREATE POLICY strict_owner_pipeline_entries ON public.pipeline_entries
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  NOT (organization_id = ANY ((SELECT private.strict_lead_member_orgs())::uuid[]))
  OR private.strict_lead_is_owned(organization_id, lead_id)
)
WITH CHECK (
  NOT (organization_id = ANY ((SELECT private.strict_lead_member_orgs())::uuid[]))
  OR private.strict_lead_is_owned(organization_id, lead_id)
);

-- RLS alone cannot enforce immutability of assignment columns. This also
-- protects writes via SECURITY DEFINER RPCs that retain the caller's JWT.
CREATE OR REPLACE FUNCTION private.guard_strict_lead_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_orgs uuid[];
  v_key text;
  v_assignment_keys text[];
BEGIN
  -- Trusted server jobs keep the existing service-role path.
  IF COALESCE(auth.role(), '') = 'service_role'
     OR (auth.uid() IS NULL AND current_user NOT IN ('authenticated', 'anon')) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  v_orgs := private.strict_lead_member_orgs();
  IF NOT (COALESCE((v_new->>'organization_id')::uuid = ANY(v_orgs), false)
       OR COALESCE((v_old->>'organization_id')::uuid = ANY(v_orgs), false)) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'lead_owners' THEN
    RAISE EXCEPTION 'Apenas administradores podem atribuir responsáveis nesta organização.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP='INSERT' AND TG_TABLE_NAME='pipeline_entries' THEN
    IF NOT private.strict_lead_is_owned(NEW.organization_id, NEW.lead_id)
       OR NOT private.strict_lead_owner_allowed(NEW.organization_id, NEW.lead_id, NEW.assigned_to::text) THEN
      RAISE EXCEPTION 'Apenas administradores podem atribuir responsáveis nesta organização.' USING ERRCODE='42501';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id'] LOOP
      IF NOT private.strict_lead_owner_allowed(NEW.organization_id, NEW.lead_id, NEW.metadata->>v_key) THEN
        RAISE EXCEPTION 'Apenas administradores podem atribuir responsáveis nesta organização.' USING ERRCODE='42501';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    v_new->'organization_id' IS DISTINCT FROM v_old->'organization_id'
    OR v_new->'id' IS DISTINCT FROM v_old->'id'
    OR (TG_TABLE_NAME = 'pipeline_entries' AND (
      v_new->'lead_id' IS DISTINCT FROM v_old->'lead_id'
      OR (v_new->'deal_id' IS DISTINCT FROM v_old->'deal_id' AND NOT (
        v_old->>'deal_id' IS NULL AND EXISTS (
          SELECT 1 FROM public.deals d WHERE d.id=(v_new->>'deal_id')::uuid
            AND d.organization_id=(v_new->>'organization_id')::uuid
            AND d.source_lead_id=(v_new->>'lead_id')::uuid
        )
      ))
    ))
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar os vínculos deste registro.' USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'leads' THEN
    v_assignment_keys := ARRAY['pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id','responsible_user_id','claimed_by'];
  ELSE
    v_assignment_keys := ARRAY['assigned_to'];
  END IF;
  FOREACH v_key IN ARRAY v_assignment_keys LOOP
    IF (v_new->>v_key) IS DISTINCT FROM (v_old->>v_key) THEN
      RAISE EXCEPTION 'Apenas administradores podem atribuir responsáveis nesta organização.' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'pipeline_entries' THEN
    FOREACH v_key IN ARRAY ARRAY['pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id'] LOOP
      IF (v_new->'metadata'->>v_key) IS DISTINCT FROM (v_old->'metadata'->>v_key) THEN
        RAISE EXCEPTION 'Apenas administradores podem atribuir responsáveis nesta organização.' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_strict_lead_assignment() FROM PUBLIC, anon, authenticated;

-- Runs after canonical-assignment/snapshot BEFORE triggers (name ordering).
CREATE TRIGGER zz_guard_strict_lead_assignment
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION private.guard_strict_lead_assignment();
CREATE TRIGGER zz_guard_strict_pipeline_assignment
BEFORE INSERT OR UPDATE ON public.pipeline_entries
FOR EACH ROW EXECUTE FUNCTION private.guard_strict_lead_assignment();
CREATE TRIGGER zz_guard_strict_lead_owners
BEFORE INSERT OR UPDATE OR DELETE ON public.lead_owners
FOR EACH ROW EXECUTE FUNCTION private.guard_strict_lead_assignment();
