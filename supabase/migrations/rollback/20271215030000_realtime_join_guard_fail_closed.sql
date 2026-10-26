-- Restore previous implementation; clean installs without strict-owner helper
-- will again fail realtime_subscription_plan with undefined_function.
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
    RETURN EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS m(org_id) WHERE m.org_id = v_org)
       AND NOT (v_org = ANY (private.strict_lead_member_orgs()));
  END IF;

  RETURN false;
END;
$$;
