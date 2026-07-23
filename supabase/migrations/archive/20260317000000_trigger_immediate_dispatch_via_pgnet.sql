-- Migration: Disparo imediato via pg_net no trigger de campanha_leads
-- Quando lead é inserido ou movido de etapa, além de agendar mensagens em
-- scheduled_campaign_messages, chama a Edge Function campaign-rule-dispatch
-- via pg_net.http_post() para processamento imediato (segundos).
-- pg_net é assíncrono: enfileira o HTTP POST e retorna sem bloquear a transação.
-- Requer: extensão pg_net habilitada, cron_config com campaign_rule_dispatch_url.
-- Date: 2026-03-17

CREATE OR REPLACE FUNCTION public.trigger_campanha_leads_dispatch_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  step_rec RECORD;
  cumul_minutes INTEGER;
  sched_at TIMESTAMPTZ;
  v_campanha_org_id UUID;
  v_whatsapp_instance_id UUID;
  v_already_sent BOOLEAN;
  v_scheduled_any BOOLEAN := false;
  v_worker_url TEXT;
  v_secret_val TEXT;
BEGIN
  -- Obter organization_id e whatsapp_instance_id da campanha
  SELECT c.organization_id, c.whatsapp_instance_id
  INTO v_campanha_org_id, v_whatsapp_instance_id
  FROM public.campanhas c
  WHERE c.id = COALESCE(NEW.campanha_id, OLD.campanha_id);

  IF v_campanha_org_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Regras: trigger_type = 'lead_created'
    FOR r IN
      SELECT id
      FROM public.campanha_dispatch_rules
      WHERE campanha_id = NEW.campanha_id
        AND is_active = true
        AND trigger_type = 'lead_created'
    LOOP
      cumul_minutes := 0;
      FOR step_rec IN
        SELECT id, template_id, delay_minutes, position
        FROM public.campanha_dispatch_rule_steps
        WHERE rule_id = r.id
        ORDER BY position
      LOOP
        sched_at := now() + (cumul_minutes || ' minutes')::interval;
        INSERT INTO public.scheduled_campaign_messages (
          campanha_id, rule_id, campanha_lead_id, lead_id, template_id,
          whatsapp_instance_id, scheduled_at, status
        )
        VALUES (
          NEW.campanha_id, r.id, NEW.id, NEW.lead_id, step_rec.template_id,
          v_whatsapp_instance_id, sched_at, 'scheduled'
        );
        v_scheduled_any := true;
        cumul_minutes := cumul_minutes + step_rec.delay_minutes;
      END LOOP;
    END LOOP;

    -- Disparo imediato: chamar Edge Function via pg_net
    IF v_scheduled_any THEN
      BEGIN
        SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
        SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
        IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', COALESCE(v_secret_val, '')
            ),
            body := jsonb_build_object('campanha_id', NEW.campanha_id::text)
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Não quebrar o INSERT se pg_net falhar
        NULL;
      END;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    -- Regras: trigger_type = 'lead_moved_to_stage' e campanha_stage_id = NEW.stage_id
    FOR r IN
      SELECT id
      FROM public.campanha_dispatch_rules
      WHERE campanha_id = NEW.campanha_id
        AND is_active = true
        AND trigger_type = 'lead_moved_to_stage'
        AND campanha_stage_id = NEW.stage_id
    LOOP
      -- Idempotência: não disparar se já existe mensagem (scheduled ou sent) para este lead+regra
      SELECT EXISTS (
        SELECT 1 FROM public.scheduled_campaign_messages
        WHERE campanha_lead_id = NEW.id
          AND rule_id = r.id
          AND status IN ('scheduled', 'sent')
      ) INTO v_already_sent;
      IF v_already_sent THEN
        CONTINUE;
      END IF;

      cumul_minutes := 0;
      FOR step_rec IN
        SELECT id, template_id, delay_minutes, position
        FROM public.campanha_dispatch_rule_steps
        WHERE rule_id = r.id
        ORDER BY position
      LOOP
        sched_at := now() + (cumul_minutes || ' minutes')::interval;
        INSERT INTO public.scheduled_campaign_messages (
          campanha_id, rule_id, campanha_lead_id, lead_id, template_id,
          whatsapp_instance_id, scheduled_at, status
        )
        VALUES (
          NEW.campanha_id, r.id, NEW.id, NEW.lead_id, step_rec.template_id,
          v_whatsapp_instance_id, sched_at, 'scheduled'
        );
        v_scheduled_any := true;
        cumul_minutes := cumul_minutes + step_rec.delay_minutes;
      END LOOP;
    END LOOP;

    -- Disparo imediato: chamar Edge Function via pg_net
    IF v_scheduled_any THEN
      BEGIN
        SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
        SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
        IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', COALESCE(v_secret_val, '')
            ),
            body := jsonb_build_object('campanha_id', NEW.campanha_id::text)
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Não quebrar o UPDATE se pg_net falhar
        NULL;
      END;
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trigger_campanha_leads_dispatch_rules IS 'Ao inserir ou mover lead na campanha, agenda mensagens e chama Edge Function campaign-rule-dispatch via pg_net para disparo imediato.';

-- O trigger já existe, mas recriamos para garantir
DROP TRIGGER IF EXISTS trg_campanha_leads_dispatch_rules ON public.campanha_leads;
CREATE TRIGGER trg_campanha_leads_dispatch_rules
  AFTER INSERT OR UPDATE OF stage_id ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_campanha_leads_dispatch_rules();
