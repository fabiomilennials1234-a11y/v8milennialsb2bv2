-- Public REST API (ADR-0008) — write RPCs for P2 (Slices 3-5, #796/#797/#798).
-- All SECURITY DEFINER, service_role-only. Each verifies the lead belongs to
-- p_org before mutating (closes the org gap in the raw action-handlers).
-- Stage moves are NOT here — they reuse the moveStage TS action-handler so the
-- full automation cascade (workflows/meeting_events/auto-Orçamentos) fires.

-- ── api_lead_exists: ownership check used by the stage endpoint ───────────────
CREATE OR REPLACE FUNCTION public.api_lead_exists(p_org uuid, p_lead_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM leads
    WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  );
$function$;

-- ── api_update_lead: allowlisted partial update, returns updated 360 ──────────
CREATE OR REPLACE FUNCTION public.api_update_lead(p_org uuid, p_lead_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  rf text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM leads WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Responsible FKs must belong to the same org.
  FOREACH rf IN ARRAY ARRAY['responsible_id','sdr_id','closer_id','pre_sale_responsible_id','sale_responsible_id'] LOOP
    IF p_patch ? rf AND NULLIF(p_patch->>rf, '') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM team_members WHERE id = (p_patch->>rf)::uuid AND organization_id = p_org
      ) THEN
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
$function$;

-- ── api_add_lead_tags: add tags by name (create missing, link) ───────────────
CREATE OR REPLACE FUNCTION public.api_add_lead_tags(p_org uuid, p_lead_id uuid, p_tags text[])
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  tag_name text;
  v_tag_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM leads WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  FOREACH tag_name IN ARRAY p_tags LOOP
    CONTINUE WHEN NULLIF(btrim(tag_name), '') IS NULL;
    SELECT id INTO v_tag_id FROM tags
    WHERE organization_id = p_org AND lower(name) = lower(btrim(tag_name)) LIMIT 1;
    IF v_tag_id IS NULL THEN
      INSERT INTO tags (organization_id, name) VALUES (p_org, btrim(tag_name))
      RETURNING id INTO v_tag_id;
    END IF;
    INSERT INTO lead_tags (lead_id, tag_id) VALUES (p_lead_id, v_tag_id)
    ON CONFLICT (lead_id, tag_id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'tags', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
    FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = p_lead_id
  ), '[]'::jsonb));
END;
$function$;

-- ── api_remove_lead_tag: unlink a tag by name ────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_remove_lead_tag(p_org uuid, p_lead_id uuid, p_tag text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM leads WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT id INTO v_tag_id FROM tags
  WHERE organization_id = p_org AND lower(name) = lower(btrim(p_tag)) LIMIT 1;
  IF v_tag_id IS NOT NULL THEN
    DELETE FROM lead_tags WHERE lead_id = p_lead_id AND tag_id = v_tag_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ── api_set_custom_fields: set values for existing fields (422 if unknown) ────
CREATE OR REPLACE FUNCTION public.api_set_custom_fields(p_org uuid, p_lead_id uuid, p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  k text;
  v_field_id uuid;
  unknown text[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM leads WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- First pass: detect unknown fields (do not write anything if any unknown).
  FOR k IN SELECT jsonb_object_keys(p_values) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM lead_custom_fields WHERE organization_id = p_org AND field_name = k
    ) THEN
      unknown := array_append(unknown, k);
    END IF;
  END LOOP;
  IF array_length(unknown, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unknown_field', 'unknown_fields', to_jsonb(unknown));
  END IF;

  -- Second pass: upsert values.
  FOR k IN SELECT jsonb_object_keys(p_values) LOOP
    SELECT id INTO v_field_id FROM lead_custom_fields
    WHERE organization_id = p_org AND field_name = k LIMIT 1;
    INSERT INTO lead_custom_field_values (lead_id, field_id, value, updated_at)
    VALUES (p_lead_id, v_field_id, p_values->>k, now())
    ON CONFLICT (lead_id, field_id) DO UPDATE SET value = excluded.value, updated_at = now();
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Permissions: service_role only.
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.api_lead_exists(uuid, uuid)',
    'public.api_update_lead(uuid, uuid, jsonb)',
    'public.api_add_lead_tags(uuid, uuid, text[])',
    'public.api_remove_lead_tag(uuid, uuid, text)',
    'public.api_set_custom_fields(uuid, uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', sig);
  END LOOP;
END $$;
