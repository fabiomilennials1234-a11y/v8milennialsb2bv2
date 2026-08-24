-- Rollback: remove segment, faturamento e utm_* do PATCH (voltam a ser ignorados).
CREATE OR REPLACE FUNCTION public.api_update_lead(p_org uuid, p_lead_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rf text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  FOREACH rf IN ARRAY ARRAY['responsible_id','sdr_id','closer_id','pre_sale_responsible_id','sale_responsible_id'] LOOP
    IF p_patch ? rf AND NULLIF(p_patch->>rf, '') IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM team_members WHERE id = (p_patch->>rf)::uuid AND organization_id = p_org) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_responsible', 'field', rf);
      END IF;
    END IF;
  END LOOP;
  UPDATE leads SET
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE name END,
    company = CASE WHEN p_patch ? 'company' THEN p_patch->>'company' ELSE company END,
    email = CASE WHEN p_patch ? 'email' THEN p_patch->>'email' ELSE email END,
    phone = CASE WHEN p_patch ? 'phone' THEN p_patch->>'phone' ELSE phone END,
    notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE notes END,
    rating = CASE WHEN p_patch ? 'rating' THEN (p_patch->>'rating')::int ELSE rating END,
    qualification_score = CASE WHEN p_patch ? 'qualification_score' THEN (p_patch->>'qualification_score')::int ELSE qualification_score END,
    qualification_tier = CASE WHEN p_patch ? 'qualification_tier' THEN (p_patch->>'qualification_tier')::qualification_tier ELSE qualification_tier END,
    pre_qualification_tier = CASE WHEN p_patch ? 'pre_qualification_tier' THEN (p_patch->>'pre_qualification_tier')::qualification_tier ELSE pre_qualification_tier END,
    responsible_id = CASE WHEN p_patch ? 'responsible_id' THEN NULLIF(p_patch->>'responsible_id','')::uuid ELSE responsible_id END,
    sdr_id = CASE WHEN p_patch ? 'sdr_id' THEN NULLIF(p_patch->>'sdr_id','')::uuid ELSE sdr_id END,
    closer_id = CASE WHEN p_patch ? 'closer_id' THEN NULLIF(p_patch->>'closer_id','')::uuid ELSE closer_id END,
    pre_sale_responsible_id = CASE WHEN p_patch ? 'pre_sale_responsible_id' THEN NULLIF(p_patch->>'pre_sale_responsible_id','')::uuid ELSE pre_sale_responsible_id END,
    sale_responsible_id = CASE WHEN p_patch ? 'sale_responsible_id' THEN NULLIF(p_patch->>'sale_responsible_id','')::uuid ELSE sale_responsible_id END,
    updated_at = now()
  WHERE id = p_lead_id AND organization_id = p_org;
  RETURN jsonb_build_object('ok', true, 'lead', public.api_get_lead(p_org, p_lead_id));
END;
$$;

