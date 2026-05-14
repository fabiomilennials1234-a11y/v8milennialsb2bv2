-- ============================================================================
-- Restore pipe_dispatch_rules triggers lost when legacy tables were dropped.
--
-- Migration 20260982 did DROP TABLE ... CASCADE on pipe_whatsapp/confirmacao/
-- propostas, which destroyed trg_pipe_*_dispatch triggers. The replacement
-- compat views (20260984) only created INSTEAD OF triggers for CRUD, not for
-- dispatch. This creates a new trigger on pipeline_entries that replicates
-- the original trigger_pipe_dispatch_rules() logic using stage_key (not the
-- old "status" column).
-- ============================================================================

-- New trigger function adapted for pipeline_entries columns
CREATE OR REPLACE FUNCTION public.trigger_pipeline_entries_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipe_type TEXT;
  r RECORD;
  v_org_id UUID;
  v_already_exists BOOLEAN;
  v_scheduled_any BOOLEAN := false;
  v_stage_id UUID;
  v_worker_url TEXT;
  v_secret_val TEXT;
BEGIN
  v_org_id := NEW.organization_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve pipe_type from pipelines table (only system pipelines)
  SELECT pip.slug INTO v_pipe_type
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';

  IF v_pipe_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- ON INSERT: rules with trigger_type = 'lead_added'
  IF TG_OP = 'INSERT' THEN
    FOR r IN
      SELECT id, whatsapp_instance_id
      FROM public.pipe_dispatch_rules
      WHERE organization_id = v_org_id
        AND pipe_type = v_pipe_type
        AND is_active = true
        AND trigger_type = 'lead_added'
    LOOP
      IF public.schedule_pipe_rule_steps_from_position(
        v_org_id, v_pipe_type, r.id, NEW.id, NEW.lead_id,
        r.whatsapp_instance_id, 0
      ) THEN
        v_scheduled_any := true;
      END IF;
    END LOOP;

    IF v_scheduled_any THEN
      BEGIN
        SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
        SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
        IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', COALESCE(v_secret_val, '')
            ),
            body := jsonb_build_object('pipe_type', v_pipe_type, 'organization_id', v_org_id::text)
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    RETURN NEW;
  END IF;

  -- ON UPDATE of stage_key: rules with trigger_type = 'lead_moved_to_stage'
  IF TG_OP = 'UPDATE' AND OLD.stage_key IS DISTINCT FROM NEW.stage_key THEN
    SELECT id INTO v_stage_id
    FROM public.pipeline_stages
    WHERE organization_id = v_org_id
      AND pipeline_type = v_pipe_type
      AND stage_key = NEW.stage_key
      AND is_active = true
    LIMIT 1;

    IF v_stage_id IS NOT NULL THEN
      FOR r IN
        SELECT id, whatsapp_instance_id
        FROM public.pipe_dispatch_rules
        WHERE organization_id = v_org_id
          AND pipe_type = v_pipe_type
          AND is_active = true
          AND trigger_type = 'lead_moved_to_stage'
          AND pipeline_stage_id = v_stage_id
      LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.scheduled_pipe_messages
          WHERE pipe_record_id = NEW.id
            AND rule_id = r.id
            AND status IN ('scheduled', 'sent', 'waiting_response')
        ) INTO v_already_exists;

        IF v_already_exists THEN
          CONTINUE;
        END IF;

        IF public.schedule_pipe_rule_steps_from_position(
          v_org_id, v_pipe_type, r.id, NEW.id, NEW.lead_id,
          r.whatsapp_instance_id, 0
        ) THEN
          v_scheduled_any := true;
        END IF;
      END LOOP;

      IF v_scheduled_any THEN
        BEGIN
          SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
          SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
          IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
            PERFORM net.http_post(
              url := v_worker_url,
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-cron-secret', COALESCE(v_secret_val, '')
              ),
              body := jsonb_build_object('pipe_type', v_pipe_type, 'organization_id', v_org_id::text)
            );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to pipeline_entries
DROP TRIGGER IF EXISTS trg_pipeline_entries_dispatch ON public.pipeline_entries;
CREATE TRIGGER trg_pipeline_entries_dispatch
  AFTER INSERT OR UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipeline_entries_dispatch();

-- ============================================================================
-- Also update stage_changed_at when stage_key changes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_stage_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.stage_key IS DISTINCT FROM NEW.stage_key THEN
    NEW.stage_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_entries_stage_changed_at ON public.pipeline_entries;
CREATE TRIGGER trg_pipeline_entries_stage_changed_at
  BEFORE UPDATE ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
  EXECUTE FUNCTION public.update_stage_changed_at();
