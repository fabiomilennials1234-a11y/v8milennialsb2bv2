-- Public REST API (ADR-0008) — lead ingest RPC for `POST /api/v1/leads`.
--
-- Closes the gap that forced partners onto `lead-webhook` (shared global
-- WEBHOOK_API_KEY, no scoping) or onto `import-leads` (JWT-only, internal).
-- This RPC is the single ingest path behind a scoped `tq_live_*` API key.
--
-- Capabilities the legacy paths lacked:
--   • custom fields — created on demand, like lead-webhook (cap 100/lead)
--   • CUSTOM pipelines — `custom_pipe_entries`, addressable by id or slug.
--     `lead-webhook` only ever reached the 3 system pipes (PipeSlug).
--
-- SECURITY DEFINER + service_role only. Every statement is scoped by p_org —
-- the caller's org comes from the API key, never from the request body.

CREATE OR REPLACE FUNCTION public.api_create_leads(
  p_org uuid,
  p_leads jsonb,
  p_options jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_update_existing boolean := COALESCE((p_options->>'update_existing')::boolean, false);
  v_default_origin  text    := NULLIF(btrim(COALESCE(p_options->>'origin', '')), '');

  item        jsonb;
  results     jsonb := '[]'::jsonb;
  v_created   int := 0;
  v_updated   int := 0;
  v_failed    int := 0;

  v_name      text;
  v_phone     text;
  v_email     text;
  v_digits    text;
  v_lead_id   uuid;
  v_existing  uuid;

  v_tag       text;
  v_tag_id    uuid;
  v_cf        jsonb;
  v_cf_key    text;
  v_field_id  uuid;

  v_pipe      jsonb;
  v_pl_id     uuid;
  v_stage_txt text;
  v_stage_id  uuid;
  v_stage_key text;
  v_pl_type   text;
  v_is_custom boolean;
  v_pipe_err  text;
BEGIN
  IF jsonb_typeof(p_leads) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_body');
  END IF;
  IF jsonb_array_length(p_leads) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'empty_batch');
  END IF;
  IF jsonb_array_length(p_leads) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'batch_too_large');
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_leads) LOOP
    v_pipe_err := NULL;
    v_lead_id  := NULL;
    v_existing := NULL;

    v_name  := NULLIF(btrim(COALESCE(item->>'name', '')), '');
    v_phone := NULLIF(btrim(COALESCE(item->>'phone', '')), '');
    v_email := NULLIF(lower(btrim(COALESCE(item->>'email', ''))), '');

    -- A lead with no identity at all is unusable downstream.
    IF v_name IS NULL AND v_phone IS NULL AND v_email IS NULL THEN
      v_failed := v_failed + 1;
      results := results || jsonb_build_object(
        'status', 'failed', 'code', 'missing_identity',
        'message', 'Informe ao menos um de: name, phone, email.'
      );
      CONTINUE;
    END IF;

    -- Dedup is opt-in: default is always-create, matching lead-webhook.
    IF v_update_existing THEN
      v_digits := NULLIF(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), '');
      IF v_digits IS NOT NULL THEN
        SELECT id INTO v_existing FROM leads
        WHERE organization_id = p_org AND deleted_at IS NULL
          AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_digits
        ORDER BY created_at ASC LIMIT 1;
      END IF;
      IF v_existing IS NULL AND v_email IS NOT NULL THEN
        SELECT id INTO v_existing FROM leads
        WHERE organization_id = p_org AND deleted_at IS NULL
          AND lower(email) = v_email
        ORDER BY created_at ASC LIMIT 1;
      END IF;
    END IF;

    IF v_existing IS NOT NULL THEN
      -- Merge: only overwrite with values the caller actually sent.
      UPDATE leads SET
        name         = COALESCE(v_name, name),
        phone        = COALESCE(v_phone, phone),
        email        = COALESCE(v_email, email),
        company      = COALESCE(NULLIF(btrim(COALESCE(item->>'company','')), ''), company),
        notes        = COALESCE(NULLIF(btrim(COALESCE(item->>'notes','')), ''), notes),
        segment      = COALESCE(NULLIF(btrim(COALESCE(item->>'segment','')), ''), segment),
        faturamento  = COALESCE(NULLIF(btrim(COALESCE(item->>'faturamento','')), ''), faturamento),
        origin       = COALESCE(NULLIF(btrim(COALESCE(item->>'origin','')), ''), v_default_origin, origin),
        rating       = COALESCE((NULLIF(item->>'rating',''))::int, rating),
        utm_source   = COALESCE(NULLIF(btrim(COALESCE(item->>'utm_source','')), ''), utm_source),
        utm_medium   = COALESCE(NULLIF(btrim(COALESCE(item->>'utm_medium','')), ''), utm_medium),
        utm_campaign = COALESCE(NULLIF(btrim(COALESCE(item->>'utm_campaign','')), ''), utm_campaign),
        updated_at   = now()
      WHERE id = v_existing AND organization_id = p_org
      RETURNING id INTO v_lead_id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO leads (
        organization_id, name, phone, email, company, notes,
        segment, faturamento, origin, rating,
        utm_source, utm_medium, utm_campaign
      ) VALUES (
        p_org,
        COALESCE(v_name, 'Lead sem nome'),
        v_phone, v_email,
        NULLIF(btrim(COALESCE(item->>'company','')), ''),
        NULLIF(btrim(COALESCE(item->>'notes','')), ''),
        NULLIF(btrim(COALESCE(item->>'segment','')), ''),
        NULLIF(btrim(COALESCE(item->>'faturamento','')), ''),
        COALESCE(NULLIF(btrim(COALESCE(item->>'origin','')), ''), v_default_origin, 'api'),
        (NULLIF(item->>'rating',''))::int,
        NULLIF(btrim(COALESCE(item->>'utm_source','')), ''),
        NULLIF(btrim(COALESCE(item->>'utm_medium','')), ''),
        NULLIF(btrim(COALESCE(item->>'utm_campaign','')), '')
      )
      RETURNING id INTO v_lead_id;
      v_created := v_created + 1;
    END IF;

    -- ── Tags (create missing, link idempotently) ─────────────────────────
    IF jsonb_typeof(item->'tags') = 'array' THEN
      FOR v_tag IN SELECT jsonb_array_elements_text(item->'tags') LOOP
        CONTINUE WHEN NULLIF(btrim(v_tag), '') IS NULL;
        SELECT id INTO v_tag_id FROM tags
        WHERE organization_id = p_org AND lower(name) = lower(btrim(v_tag)) LIMIT 1;
        IF v_tag_id IS NULL THEN
          INSERT INTO tags (organization_id, name) VALUES (p_org, btrim(v_tag))
          RETURNING id INTO v_tag_id;
        END IF;
        INSERT INTO lead_tags (lead_id, tag_id) VALUES (v_lead_id, v_tag_id)
        ON CONFLICT (lead_id, tag_id) DO NOTHING;
      END LOOP;
    END IF;

    -- ── Custom fields ────────────────────────────────────────────────────
    -- Ingest CREATES unknown fields (a partner cannot pre-register a schema).
    -- This deliberately differs from PUT /leads/{id}/custom-fields, which 422s
    -- on unknown names to stop typos silently forking the org's field list.
    v_cf := item->'custom_fields';
    IF jsonb_typeof(v_cf) = 'object' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(v_cf)) > 100 THEN
        v_pipe_err := 'custom_fields excede o limite de 100 campos';
      ELSE
        FOR v_cf_key IN SELECT jsonb_object_keys(v_cf) LOOP
          CONTINUE WHEN NULLIF(btrim(v_cf_key), '') IS NULL;
          SELECT id INTO v_field_id FROM lead_custom_fields
          WHERE organization_id = p_org AND field_name = v_cf_key LIMIT 1;
          IF v_field_id IS NULL THEN
            INSERT INTO lead_custom_fields (organization_id, field_name, field_type)
            VALUES (p_org, v_cf_key, 'text')
            RETURNING id INTO v_field_id;
          END IF;
          INSERT INTO lead_custom_field_values (lead_id, field_id, value, updated_at)
          VALUES (v_lead_id, v_field_id, v_cf->>v_cf_key, now())
          ON CONFLICT (lead_id, field_id) DO UPDATE
            SET value = excluded.value, updated_at = now();
        END LOOP;
      END IF;
    END IF;

    -- ── Pipeline placement — system OR custom ────────────────────────────
    v_pipe := item->'pipeline';
    IF jsonb_typeof(v_pipe) = 'object' THEN
      v_stage_txt := NULLIF(btrim(COALESCE(v_pipe->>'stage', '')), '');
      v_pl_id     := NULL;
      v_pl_type   := NULL;
      v_is_custom := false;

      -- `pipelines` is the unified registry: system funnels AND custom ones
      -- (custom_pipelines rows are mirrored into it under the SAME id, with
      -- type='custom' — verified 79/79 in prod). So resolve once here and
      -- branch on `type`; never probe custom_pipelines by slug first, or a
      -- custom funnel gets misread as a system pipe and its stage lookup fails.
      IF NULLIF(btrim(COALESCE(v_pipe->>'pipeline_id','')), '') IS NOT NULL THEN
        BEGIN
          SELECT id, type INTO v_pl_id, v_pl_type FROM pipelines
          WHERE organization_id = p_org AND id = (v_pipe->>'pipeline_id')::uuid
            AND is_active = true;
        EXCEPTION WHEN invalid_text_representation THEN
          v_pl_id := NULL; -- malformed uuid → handled as not_found below
        END;
      ELSIF NULLIF(btrim(COALESCE(v_pipe->>'pipe','')), '') IS NOT NULL THEN
        SELECT id, type INTO v_pl_id, v_pl_type FROM pipelines
        WHERE organization_id = p_org AND slug = btrim(v_pipe->>'pipe')
          AND is_active = true LIMIT 1;
      END IF;
      v_is_custom := (v_pl_type = 'custom');

      IF v_pl_id IS NULL THEN
        v_pipe_err := 'pipeline não encontrado nesta organização';
      ELSIF v_stage_txt IS NULL THEN
        v_pipe_err := 'pipeline.stage é obrigatório';
      ELSIF v_is_custom THEN
        -- Stage accepted as stage_key OR display name, case-insensitive.
        SELECT id INTO v_stage_id FROM custom_pipeline_stages
        WHERE pipeline_id = v_pl_id AND organization_id = p_org AND is_active = true
          AND (lower(stage_key) = lower(v_stage_txt) OR lower(btrim(name)) = lower(v_stage_txt))
        ORDER BY position ASC LIMIT 1;
        IF v_stage_id IS NULL THEN
          v_pipe_err := format('etapa "%s" não existe nesse funil', v_stage_txt);
        ELSE
          -- custom_pipe_entries is the source of truth for custom funnels.
          -- trg_sync_custom_pipe_to_entries mirrors the row into
          -- pipeline_entries, and trg_workflow_custom_pipe_entry fires the
          -- workflow triggers — same cascade the UI gets. Never write the
          -- mirror directly.
          INSERT INTO custom_pipe_entries (organization_id, pipeline_id, lead_id, stage_id)
          VALUES (p_org, v_pl_id, v_lead_id, v_stage_id)
          ON CONFLICT (pipeline_id, lead_id) DO UPDATE
            SET stage_id = excluded.stage_id, stage_changed_at = now(), updated_at = now();
        END IF;
      ELSE
        SELECT ps.stage_key INTO v_stage_key
        FROM pipeline_stages ps
        JOIN pipelines pl ON pl.slug = ps.pipeline_type
        WHERE pl.id = v_pl_id AND ps.organization_id = p_org AND ps.is_active = true
          AND (lower(ps.stage_key) = lower(v_stage_txt) OR lower(btrim(ps.name)) = lower(v_stage_txt))
        ORDER BY ps.position ASC LIMIT 1;
        IF v_stage_key IS NULL THEN
          v_pipe_err := format('etapa "%s" não existe nesse funil', v_stage_txt);
        ELSE
          INSERT INTO pipeline_entries (organization_id, pipeline_id, lead_id, stage_key)
          VALUES (p_org, v_pl_id, v_lead_id, v_stage_key)
          ON CONFLICT (pipeline_id, lead_id) DO UPDATE
            SET stage_key = excluded.stage_key, stage_changed_at = now(), updated_at = now();
        END IF;
      END IF;
    END IF;

    results := results || jsonb_build_object(
      'status', CASE WHEN v_existing IS NOT NULL THEN 'updated' ELSE 'created' END,
      'lead_id', v_lead_id,
      'warning', v_pipe_err
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'failed', v_failed,
    'results', results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.api_create_leads(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_leads(uuid, jsonb, jsonb) TO service_role;
