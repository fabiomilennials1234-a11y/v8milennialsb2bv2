-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20270908008000_disparo_por_etapa_em_funil_custom (SCRUM-629/W3)
-- ═══════════════════════════════════════════════════════════════════════════
-- Restaura o estado pré-W3: dispatch cego para custom (early-return por
-- type='system'), claim sem gate, chaves por pipe_type, colunas removidas.
--
-- PERDA CONHECIDA E ACEITA: toggles ligados em funis custom e os carimbos
-- stage_dispatch_enabled_at somem com as colunas. Itens de fila cancelados
-- pelo desligamento de toggle permanecem 'cancelled' (história, não revertida).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §5⁻¹ · trigger_pipeline_entries_dispatch: versão de prod (baseline) ──────

DROP TRIGGER IF EXISTS trg_pipeline_entries_dispatch ON public.pipeline_entries;

CREATE OR REPLACE FUNCTION public.trigger_pipeline_entries_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

CREATE TRIGGER trg_pipeline_entries_dispatch
  AFTER INSERT OR UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_pipeline_entries_dispatch();

-- ── §4⁻¹ · claims: versão de prod sem gate; variante por funil morre ─────────

CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch(p_pipe_type text DEFAULT NULL::text, p_limit integer DEFAULT 50)
RETURNS TABLE (claimed_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id
    FROM public.scheduled_pipe_messages
    WHERE status = 'scheduled'
      AND scheduled_at <= now()
      AND (p_pipe_type IS NULL OR pipe_type = p_pipe_type)
    ORDER BY scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_pipe_messages spm
  SET status = 'processing', scheduled_at = now()
  FROM batch
  WHERE spm.id = batch.id
  RETURNING spm.id AS claimed_id;
END;
$$;

DROP FUNCTION IF EXISTS public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer);

-- ── §3⁻¹ · scheduled_pipe_messages ───────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_scheduled_pipe_messages_resolve_pipeline ON public.scheduled_pipe_messages;
DROP FUNCTION IF EXISTS public.scheduled_pipe_messages_resolve_pipeline();
DROP INDEX IF EXISTS public.idx_scheduled_pipe_messages_pipeline_status;
-- PERDA CONHECIDA: itens de fila de funis custom não sobrevivem ao vocabulário
-- fechado pré-W3 — apagados antes de restaurar o CHECK dos 3 slugs.
DELETE FROM public.scheduled_pipe_messages
 WHERE pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas');
ALTER TABLE public.scheduled_pipe_messages DROP CONSTRAINT IF EXISTS scheduled_pipe_messages_pipe_type_check;
ALTER TABLE public.scheduled_pipe_messages ADD CONSTRAINT scheduled_pipe_messages_pipe_type_check
  CHECK (pipe_type = ANY (ARRAY['whatsapp'::text, 'confirmacao'::text, 'propostas'::text]));
ALTER TABLE public.scheduled_pipe_messages DROP COLUMN IF EXISTS pipeline_id;

-- ── §2⁻¹ · pipe_dispatch_rules ───────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_pipe_dispatch_rules_resolve_pipeline ON public.pipe_dispatch_rules;
DROP FUNCTION IF EXISTS public.pipe_dispatch_rules_resolve_pipeline();
DROP INDEX IF EXISTS public.idx_pipe_dispatch_rules_pipeline;
-- PERDA CONHECIDA: regras de funis custom não existem no mundo pré-W3.
DELETE FROM public.pipe_dispatch_rules
 WHERE pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas');
ALTER TABLE public.pipe_dispatch_rules DROP CONSTRAINT IF EXISTS pipe_dispatch_rules_pipe_type_check;
ALTER TABLE public.pipe_dispatch_rules ADD CONSTRAINT pipe_dispatch_rules_pipe_type_check
  CHECK (pipe_type = ANY (ARRAY['whatsapp'::text, 'confirmacao'::text, 'propostas'::text]));
ALTER TABLE public.pipe_dispatch_rules DROP COLUMN IF EXISTS pipeline_id;

-- ── §1⁻¹ · pipelines ─────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_pipelines_stage_dispatch_toggle ON public.pipelines;
DROP FUNCTION IF EXISTS public.pipelines_stage_dispatch_toggle();
ALTER TABLE public.pipelines
  DROP COLUMN IF EXISTS stage_dispatch_enabled,
  DROP COLUMN IF EXISTS stage_dispatch_enabled_at;

-- ── Asserções do rollback ────────────────────────────────────────────────────

DO $assert$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND (table_name, column_name) IN (('pipelines','stage_dispatch_enabled'),
                                                  ('pipe_dispatch_rules','pipeline_id'),
                                                  ('scheduled_pipe_messages','pipeline_id'))) THEN
    RAISE EXCEPTION 'ROLLBACK629: coluna nova ainda viva';
  END IF;
  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'trigger_pipeline_entries_dispatch')
     NOT LIKE '%pip.type = ''system''%' THEN
    RAISE EXCEPTION 'ROLLBACK629: early-return de custom não restaurado';
  END IF;
  RAISE NOTICE 'ROLLBACK629 OK: estado pré-W3 restaurado.';
END;
$assert$;
