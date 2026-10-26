-- Preserve optional strict-owner authorization; avoid HTTP404/42883 on clean installs.
CREATE OR REPLACE FUNCTION private.realtime_can_join(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match text[];
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL OR p_topic IS NULL THEN
    RETURN false;
  END IF;

  -- Formato fechado, minúsculo (uuid::text). Tópico desconhecido = nega.
  v_match := regexp_match(
    p_topic,
    '^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(pe)$'
  );
  IF v_match IS NULL THEN
    RETURN false;
  END IF;
  v_org := v_match[1]::uuid;

  IF v_match[2] = 'pe' THEN
    -- Some clean installations do not have the optional strict-owner rollout.
    -- Missing authorization metadata must disable broadcast, never remove the
    -- owner filter. Postgres Changes remains the safe frontend fallback.
    IF to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN
      RETURN false;
    END IF;
    RETURN EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS m(org_id) WHERE m.org_id = v_org)
       AND NOT (v_org = ANY (private.strict_lead_member_orgs()));
  END IF;

  RETURN false;
END;
$$;
