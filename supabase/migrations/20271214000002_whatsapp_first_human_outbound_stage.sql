-- Opt-in per pipeline; installation alone does not enable any organization.
-- The first successful human send after activation advances the current open
-- entry from the configured initial stage, once. No messages or deals are created.
CREATE OR REPLACE FUNCTION private.advance_pipeline_on_human_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rule record;
  v_entry public.pipeline_entries%ROWTYPE;
  v_enabled_at timestamptz;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'outgoing'
     OR NEW.sent_source IS DISTINCT FROM 'manual'
     OR COALESCE(NEW.sent_by_ai, false)
     OR NEW.status IS NULL OR NEW.status NOT IN ('sent', 'delivered', 'read')
     OR NEW.received_via = 'history_sync'
     OR COALESCE(NEW.is_group, false)
     OR COALESCE(NEW.remote_jid, '') LIKE '%@g.us'
     OR COALESCE(NEW.edited, false) OR NEW.deleted_at IS NOT NULL
     OR NEW.lead_id IS NULL OR NEW.instance_id IS NULL
     OR NEW.timestamp IS NULL OR NEW.created_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Browser fallback inserts must not turn this definer into a way to move
  -- another representative's lead. Server ingestion retains its trusted path.
  IF auth.role() = 'anon' OR (
    auth.uid() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role'
    AND NOT COALESCE(public.can_see_chat_scope(NEW.organization_id, NEW.lead_id, NULL), false)
  ) THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.whatsapp_instances i ON i.organization_id = l.organization_id
    WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id
      AND l.deleted_at IS NULL AND i.id = NEW.instance_id
  ) THEN RETURN NEW; END IF;

  FOR v_rule IN
    SELECT p.id AS pipeline_id, p.config->'first_human_outbound_stage' AS config,
           s.id AS from_id, s.stage_key AS from_key,
           t.id AS to_id, t.stage_key AS to_key
    FROM public.pipelines p
    JOIN public.pipeline_stages s ON s.pipeline_id = p.id
      AND s.organization_id = p.organization_id
      AND s.id::text = p.config->'first_human_outbound_stage'->>'from_stage_id'
    JOIN public.pipeline_stages t ON t.pipeline_id = p.id
      AND t.organization_id = p.organization_id
      AND t.id::text = p.config->'first_human_outbound_stage'->>'to_stage_id'
    WHERE p.organization_id = NEW.organization_id AND p.is_active
      AND p.config->'first_human_outbound_stage'->'enabled' = 'true'::jsonb
      AND p.config->'first_human_outbound_stage'->>'instance_id' = NEW.instance_id::text
      AND s.is_active AND t.is_active AND t.position > s.position
      AND s.stage_role = 'open' AND t.stage_role = 'open'
      AND NOT s.is_final_positive AND NOT s.is_final_negative
      AND NOT t.is_final_positive AND NOT t.is_final_negative
  LOOP
    -- Configuration is JSON: an invalid activation date must not block ingestion.
    BEGIN
      v_enabled_at := (v_rule.config->>'enabled_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      CONTINUE;
    END;
    IF v_enabled_at IS NULL OR NEW.timestamp < v_enabled_at
       OR NEW.created_at < v_enabled_at THEN CONTINUE; END IF;

    -- Same current-entry ordering as the existing move-stage action. Lock before
    -- inspecting the stage/marker so concurrent sends cannot advance twice.
    SELECT e.* INTO v_entry
    FROM public.pipeline_entries e
    JOIN public.pipeline_stages s ON s.id = e.stage_id
      AND s.pipeline_id = e.pipeline_id AND s.organization_id = e.organization_id
    LEFT JOIN public.deals d ON d.id = e.deal_id
    WHERE e.organization_id = NEW.organization_id AND e.lead_id = NEW.lead_id
      AND e.pipeline_id = v_rule.pipeline_id AND e.closed_at IS NULL
      AND s.stage_role NOT IN ('won', 'lost')
      AND NOT s.is_final_positive AND NOT s.is_final_negative
      AND (e.deal_id IS NULL OR (d.organization_id = e.organization_id
        AND d.source_lead_id = e.lead_id AND d.deleted_at IS NULL
        AND d.closed_at IS NULL AND d.outcome = 'open'))
    ORDER BY e.stage_changed_at DESC NULLS LAST, e.created_at DESC, e.id DESC
    LIMIT 1 FOR UPDATE OF e;

    IF NOT FOUND OR v_entry.stage_id IS DISTINCT FROM v_rule.from_id
       OR v_entry.created_at > NEW.timestamp
       OR COALESCE(v_entry.metadata, '{}'::jsonb) ? 'first_human_outbound_stage'
    THEN CONTINUE; END IF;

    UPDATE public.pipeline_entries
    SET stage_id = v_rule.to_id, stage_key = v_rule.to_key,
        stage_changed_at = clock_timestamp(), updated_at = clock_timestamp(),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'first_human_outbound_stage', jsonb_build_object(
            'message_id', NEW.id, 'provider_message_id', NEW.message_id,
            'instance_id', NEW.instance_id, 'sent_at', NEW.timestamp,
            'sent_by_team_member_id', NEW.sent_by_team_member_id,
            'from_stage_id', v_rule.from_id, 'to_stage_id', v_rule.to_id,
            'moved_at', clock_timestamp()))
    WHERE id = v_entry.id AND organization_id = NEW.organization_id
      AND stage_id = v_rule.from_id AND closed_at IS NULL
      AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'first_human_outbound_stage');
    -- Existing pipeline triggers maintain mirrors, history and stage events.
    -- Assignment fields and RLS policies are unchanged.
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.advance_pipeline_on_human_outbound()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_first_human_outbound_stage ON public.whatsapp_messages;
CREATE TRIGGER trg_first_human_outbound_stage
AFTER INSERT OR UPDATE OF status, lead_id ON public.whatsapp_messages
FOR EACH ROW WHEN (
  NEW.direction = 'outgoing' AND NEW.sent_source = 'manual'
  AND NOT COALESCE(NEW.sent_by_ai, false)
  AND NEW.received_via IS DISTINCT FROM 'history_sync'
)
EXECUTE FUNCTION private.advance_pipeline_on_human_outbound();

COMMENT ON FUNCTION private.advance_pipeline_on_human_outbound() IS
  'Opt-in via pipelines.config.first_human_outbound_stage: enabled, enabled_at, instance_id, from_stage_id, to_stage_id. First new successful manual WhatsApp send advances only the current open initial-stage entry, once; no historical backfill.';
