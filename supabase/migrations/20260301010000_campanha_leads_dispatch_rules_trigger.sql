-- Migration: Triggers em campanha_leads para preencher scheduled_campaign_messages
-- Ao inserir lead na campanha: regras com trigger_type = 'lead_created'
-- Ao atualizar stage_id do lead: regras com trigger_type = 'lead_moved_to_stage' e campanha_stage_id = NEW.stage_id
-- Idempotência: no UPDATE, não disparar se já existir mensagem agendada/enviada para esse (campanha_lead_id, rule_id)
-- Date: 2026-03-01

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
        cumul_minutes := cumul_minutes + step_rec.delay_minutes;
      END LOOP;
    END LOOP;
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
        cumul_minutes := cumul_minutes + step_rec.delay_minutes;
      END LOOP;
    END LOOP;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trigger_campanha_leads_dispatch_rules IS 'Ao inserir ou mover lead na campanha, agenda mensagens em scheduled_campaign_messages conforme regras ativas.';

DROP TRIGGER IF EXISTS trg_campanha_leads_dispatch_rules ON public.campanha_leads;
CREATE TRIGGER trg_campanha_leads_dispatch_rules
  AFTER INSERT OR UPDATE OF stage_id ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_campanha_leads_dispatch_rules();
