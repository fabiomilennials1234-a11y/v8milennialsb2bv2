-- The organizational evaluator never reads leads with an unrestricted service
-- query. Authorization and the data read share one transaction/lock boundary.
CREATE OR REPLACE FUNCTION public.read_guided_condition_lead(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid
) RETURNS TABLE(id uuid, organization_id uuid, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT w.organization_id INTO v_organization_id
  FROM public.workflows w
  JOIN public.workflow_data_grants g
    ON g.workflow_id = w.id AND g.organization_id = w.organization_id
  WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id
    AND g.resource_scope = 'organization_leads'
    AND g.fields @> ARRAY['lead.name']::text[]
    AND NOT public.org_access_blocked(w.organization_id)
  FOR SHARE OF w, g;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  -- Grant revocation must acquire an UPDATE lock, so it cannot complete in
  -- between this permission check and its corresponding read. No cache of
  -- permission or creator membership participates in this decision.
  RETURN QUERY SELECT l.id, l.organization_id, l.name
  FROM public.leads l
  WHERE l.id = p_lead_id AND l.organization_id = v_organization_id
    AND l.deleted_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_lead(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_lead(uuid, uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
