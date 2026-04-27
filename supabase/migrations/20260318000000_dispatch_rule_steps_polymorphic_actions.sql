-- Migration: Steps polimórficos para regras de envio por etapa
-- Adiciona action_type aos steps e scheduled_campaign_messages para suportar:
--   send_template (existente), wait_response, change_stage, assign_sdr, cancel_sequence
-- Date: 2026-03-18

-- ============================================
-- 1. campanha_dispatch_rule_steps: novas colunas
-- ============================================

-- action_type: tipo da ação (default = send_template para manter compat)
ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'send_template';

-- template_id agora é nullable (obrigatório só para send_template)
ALTER TABLE public.campanha_dispatch_rule_steps
ALTER COLUMN template_id DROP NOT NULL;

-- wait_response: timeout e ação alternativa
ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS wait_timeout_minutes INTEGER DEFAULT 1440;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS timeout_action TEXT DEFAULT 'continue';

ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS timeout_target_stage_id UUID REFERENCES public.campanha_stages(id) ON DELETE SET NULL;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS timeout_template_id UUID REFERENCES public.campaign_templates(id) ON DELETE SET NULL;

-- change_stage: etapa destino
ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS target_stage_id UUID REFERENCES public.campanha_stages(id) ON DELETE SET NULL;

-- assign_sdr: modo e SDR fixo
ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS sdr_assignment_mode TEXT DEFAULT 'specific';

ALTER TABLE public.campanha_dispatch_rule_steps
ADD COLUMN IF NOT EXISTS target_sdr_id UUID;

-- Constraints
ALTER TABLE public.campanha_dispatch_rule_steps
DROP CONSTRAINT IF EXISTS chk_step_action_type;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD CONSTRAINT chk_step_action_type CHECK (
  action_type IN ('send_template', 'wait_response', 'change_stage', 'assign_sdr', 'cancel_sequence')
);

-- template_id obrigatório para send_template
ALTER TABLE public.campanha_dispatch_rule_steps
DROP CONSTRAINT IF EXISTS chk_step_template_required;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD CONSTRAINT chk_step_template_required CHECK (
  action_type != 'send_template' OR template_id IS NOT NULL
);

-- target_stage_id obrigatório para change_stage
ALTER TABLE public.campanha_dispatch_rule_steps
DROP CONSTRAINT IF EXISTS chk_step_stage_required;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD CONSTRAINT chk_step_stage_required CHECK (
  action_type != 'change_stage' OR target_stage_id IS NOT NULL
);

-- timeout_action válido
ALTER TABLE public.campanha_dispatch_rule_steps
DROP CONSTRAINT IF EXISTS chk_step_timeout_action;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD CONSTRAINT chk_step_timeout_action CHECK (
  timeout_action IS NULL OR timeout_action IN ('continue', 'change_stage', 'send_template', 'cancel_sequence')
);

-- sdr_assignment_mode válido
ALTER TABLE public.campanha_dispatch_rule_steps
DROP CONSTRAINT IF EXISTS chk_step_sdr_mode;

ALTER TABLE public.campanha_dispatch_rule_steps
ADD CONSTRAINT chk_step_sdr_mode CHECK (
  sdr_assignment_mode IS NULL OR sdr_assignment_mode IN ('specific', 'round_robin')
);

COMMENT ON COLUMN public.campanha_dispatch_rule_steps.action_type IS 'Tipo de ação: send_template, wait_response, change_stage, assign_sdr, cancel_sequence';
COMMENT ON COLUMN public.campanha_dispatch_rule_steps.wait_timeout_minutes IS 'Para wait_response: minutos até timeout (default 1440 = 24h)';
COMMENT ON COLUMN public.campanha_dispatch_rule_steps.timeout_action IS 'Para wait_response: ação no timeout (continue, change_stage, send_template, cancel_sequence)';
COMMENT ON COLUMN public.campanha_dispatch_rule_steps.target_stage_id IS 'Para change_stage: etapa destino';
COMMENT ON COLUMN public.campanha_dispatch_rule_steps.sdr_assignment_mode IS 'Para assign_sdr: specific ou round_robin';
COMMENT ON COLUMN public.campanha_dispatch_rule_steps.target_sdr_id IS 'Para assign_sdr com mode=specific: UUID do SDR';

-- ============================================
-- 2. scheduled_campaign_messages: novas colunas
-- ============================================

-- action_type
ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'send_template';

-- template_id agora nullable
ALTER TABLE public.scheduled_campaign_messages
ALTER COLUMN template_id DROP NOT NULL;

-- wait_response tracking
ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;

ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS wait_timeout_at TIMESTAMPTZ;

-- Configuração da ação timeout (copiada do step)
ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS timeout_action TEXT;

ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS timeout_target_stage_id UUID REFERENCES public.campanha_stages(id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS timeout_template_id UUID REFERENCES public.campaign_templates(id) ON DELETE SET NULL;

-- change_stage / assign_sdr
ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS target_stage_id UUID REFERENCES public.campanha_stages(id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS sdr_assignment_mode TEXT;

ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS target_sdr_id UUID;

-- step_position: posição do step que originou este registro
ALTER TABLE public.scheduled_campaign_messages
ADD COLUMN IF NOT EXISTS step_position INTEGER;

-- Atualizar CHECK de status para incluir novos status
ALTER TABLE public.scheduled_campaign_messages
DROP CONSTRAINT IF EXISTS scheduled_campaign_messages_status_check;

ALTER TABLE public.scheduled_campaign_messages
ADD CONSTRAINT scheduled_campaign_messages_status_check CHECK (
  status IN ('scheduled', 'sent', 'failed', 'cancelled', 'waiting_response', 'response_received', 'timed_out', 'executed')
);

-- action_type CHECK
ALTER TABLE public.scheduled_campaign_messages
DROP CONSTRAINT IF EXISTS chk_scm_action_type;

ALTER TABLE public.scheduled_campaign_messages
ADD CONSTRAINT chk_scm_action_type CHECK (
  action_type IN ('send_template', 'wait_response', 'change_stage', 'assign_sdr', 'cancel_sequence')
);

-- Índice para buscar waiting_response por lead (detecção de resposta)
CREATE INDEX IF NOT EXISTS idx_scm_waiting_response_lead
  ON public.scheduled_campaign_messages(lead_id, status)
  WHERE status = 'waiting_response';

-- Índice para buscar timeouts vencidos (worker/cron)
CREATE INDEX IF NOT EXISTS idx_scm_waiting_timeout
  ON public.scheduled_campaign_messages(status, wait_timeout_at)
  WHERE status = 'waiting_response';

COMMENT ON COLUMN public.scheduled_campaign_messages.action_type IS 'Tipo de ação: send_template, wait_response, change_stage, assign_sdr, cancel_sequence';
COMMENT ON COLUMN public.scheduled_campaign_messages.waiting_since IS 'Para wait_response: timestamp de quando começou a esperar';
COMMENT ON COLUMN public.scheduled_campaign_messages.wait_timeout_at IS 'Para wait_response: timestamp de quando o timeout expira';
COMMENT ON COLUMN public.scheduled_campaign_messages.step_position IS 'Posição do step que originou este registro (para agendar próximos steps após resposta)';

-- ============================================
-- 3. Função helper: agendar steps a partir de uma posição
--    Usada pelo trigger de campanha_leads e pelo trigger de resposta
-- ============================================

CREATE OR REPLACE FUNCTION public.schedule_rule_steps_from_position(
  p_campanha_id UUID,
  p_rule_id UUID,
  p_campanha_lead_id UUID,
  p_lead_id UUID,
  p_whatsapp_instance_id UUID,
  p_from_position INTEGER DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  step_rec RECORD;
  cumul_minutes INTEGER := 0;
  sched_at TIMESTAMPTZ;
  v_scheduled_any BOOLEAN := false;
BEGIN
  FOR step_rec IN
    SELECT id, action_type, template_id, delay_minutes, position,
           wait_timeout_minutes, timeout_action, timeout_target_stage_id, timeout_template_id,
           target_stage_id, sdr_assignment_mode, target_sdr_id
    FROM public.campanha_dispatch_rule_steps
    WHERE rule_id = p_rule_id
      AND position >= p_from_position
    ORDER BY position
  LOOP
    cumul_minutes := cumul_minutes + step_rec.delay_minutes;
    sched_at := now() + (cumul_minutes || ' minutes')::interval;

    IF step_rec.action_type = 'send_template' THEN
      INSERT INTO public.scheduled_campaign_messages (
        campanha_id, rule_id, campanha_lead_id, lead_id, template_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position
      ) VALUES (
        p_campanha_id, p_rule_id, p_campanha_lead_id, p_lead_id, step_rec.template_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'send_template', step_rec.position
      );
      v_scheduled_any := true;

    ELSIF step_rec.action_type = 'wait_response' THEN
      INSERT INTO public.scheduled_campaign_messages (
        campanha_id, rule_id, campanha_lead_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position,
        waiting_since, wait_timeout_at,
        timeout_action, timeout_target_stage_id, timeout_template_id
      ) VALUES (
        p_campanha_id, p_rule_id, p_campanha_lead_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'wait_response', step_rec.position,
        NULL, NULL,  -- preenchidos quando o worker processar
        step_rec.timeout_action, step_rec.timeout_target_stage_id, step_rec.timeout_template_id
      );
      v_scheduled_any := true;
      -- BARREIRA: parar de agendar steps após wait_response
      EXIT;

    ELSIF step_rec.action_type = 'change_stage' THEN
      INSERT INTO public.scheduled_campaign_messages (
        campanha_id, rule_id, campanha_lead_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position,
        target_stage_id
      ) VALUES (
        p_campanha_id, p_rule_id, p_campanha_lead_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'change_stage', step_rec.position,
        step_rec.target_stage_id
      );
      v_scheduled_any := true;

    ELSIF step_rec.action_type = 'assign_sdr' THEN
      INSERT INTO public.scheduled_campaign_messages (
        campanha_id, rule_id, campanha_lead_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position,
        sdr_assignment_mode, target_sdr_id
      ) VALUES (
        p_campanha_id, p_rule_id, p_campanha_lead_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'assign_sdr', step_rec.position,
        step_rec.sdr_assignment_mode, step_rec.target_sdr_id
      );
      v_scheduled_any := true;

    ELSIF step_rec.action_type = 'cancel_sequence' THEN
      INSERT INTO public.scheduled_campaign_messages (
        campanha_id, rule_id, campanha_lead_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position
      ) VALUES (
        p_campanha_id, p_rule_id, p_campanha_lead_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'cancel_sequence', step_rec.position
      );
      v_scheduled_any := true;

    END IF;
  END LOOP;

  RETURN v_scheduled_any;
END;
$$;

COMMENT ON FUNCTION public.schedule_rule_steps_from_position IS 'Agenda steps de uma regra a partir de uma posição. Para ao encontrar wait_response (barreira). Usada por triggers de campanha_leads e resposta do lead.';

-- ============================================
-- 4. Atualizar trigger de campanha_leads para usar a função helper
-- ============================================

CREATE OR REPLACE FUNCTION public.trigger_campanha_leads_dispatch_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
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
    FOR r IN
      SELECT id
      FROM public.campanha_dispatch_rules
      WHERE campanha_id = NEW.campanha_id
        AND is_active = true
        AND trigger_type = 'lead_created'
    LOOP
      IF public.schedule_rule_steps_from_position(
        NEW.campanha_id, r.id, NEW.id, NEW.lead_id, v_whatsapp_instance_id, 0
      ) THEN
        v_scheduled_any := true;
      END IF;
    END LOOP;

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
        NULL;
      END;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    FOR r IN
      SELECT id
      FROM public.campanha_dispatch_rules
      WHERE campanha_id = NEW.campanha_id
        AND is_active = true
        AND trigger_type = 'lead_moved_to_stage'
        AND campanha_stage_id = NEW.stage_id
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM public.scheduled_campaign_messages
        WHERE campanha_lead_id = NEW.id
          AND rule_id = r.id
          AND status IN ('scheduled', 'sent', 'waiting_response')
      ) INTO v_already_sent;
      IF v_already_sent THEN
        CONTINUE;
      END IF;

      IF public.schedule_rule_steps_from_position(
        NEW.campanha_id, r.id, NEW.id, NEW.lead_id, v_whatsapp_instance_id, 0
      ) THEN
        v_scheduled_any := true;
      END IF;
    END LOOP;

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
        NULL;
      END;
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trigger_campanha_leads_dispatch_rules IS 'Ao inserir ou mover lead na campanha, agenda steps (com barreira wait_response) e chama Edge Function via pg_net.';

DROP TRIGGER IF EXISTS trg_campanha_leads_dispatch_rules ON public.campanha_leads;
CREATE TRIGGER trg_campanha_leads_dispatch_rules
  AFTER INSERT OR UPDATE OF stage_id ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_campanha_leads_dispatch_rules();

-- ============================================
-- 5. Trigger de detecção de resposta em whatsapp_messages
-- ============================================

CREATE OR REPLACE FUNCTION public.trigger_whatsapp_response_detection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  waiting_rec RECORD;
  v_next_position INTEGER;
  v_campanha_lead RECORD;
  v_whatsapp_instance_id UUID;
  v_worker_url TEXT;
  v_secret_val TEXT;
  v_triggered_campaigns UUID[] := '{}';
BEGIN
  -- Somente mensagens recebidas (incoming)
  IF NEW.direction != 'incoming' THEN
    RETURN NEW;
  END IF;

  -- Buscar scheduled_campaign_messages com status = 'waiting_response' para este lead
  FOR waiting_rec IN
    SELECT scm.id, scm.campanha_id, scm.rule_id, scm.campanha_lead_id, scm.lead_id,
           scm.whatsapp_instance_id, scm.step_position
    FROM public.scheduled_campaign_messages scm
    WHERE scm.lead_id = NEW.lead_id
      AND scm.status = 'waiting_response'
  LOOP
    -- Marcar como response_received
    UPDATE public.scheduled_campaign_messages
    SET status = 'response_received',
        sent_at = now()
    WHERE id = waiting_rec.id;

    -- Próxima posição na sequência
    v_next_position := waiting_rec.step_position + 1;

    -- Obter whatsapp_instance_id da campanha
    SELECT c.whatsapp_instance_id
    INTO v_whatsapp_instance_id
    FROM public.campanhas c
    WHERE c.id = waiting_rec.campanha_id;

    -- Agendar próximos steps (a partir da posição seguinte)
    PERFORM public.schedule_rule_steps_from_position(
      waiting_rec.campanha_id,
      waiting_rec.rule_id,
      waiting_rec.campanha_lead_id,
      waiting_rec.lead_id,
      COALESCE(waiting_rec.whatsapp_instance_id, v_whatsapp_instance_id),
      v_next_position
    );

    -- Guardar campanha para disparo via pg_net
    IF NOT waiting_rec.campanha_id = ANY(v_triggered_campaigns) THEN
      v_triggered_campaigns := v_triggered_campaigns || waiting_rec.campanha_id;
    END IF;
  END LOOP;

  -- Disparar Edge Function para cada campanha afetada
  IF array_length(v_triggered_campaigns, 1) > 0 THEN
    BEGIN
      SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
      SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
      IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
        FOR i IN 1..array_length(v_triggered_campaigns, 1) LOOP
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', COALESCE(v_secret_val, '')
            ),
            body := jsonb_build_object('campanha_id', v_triggered_campaigns[i]::text)
          );
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_whatsapp_response_detection IS 'Detecta resposta do lead em whatsapp_messages. Se houver wait_response ativo, marca como response_received e agenda próximos steps.';

DROP TRIGGER IF EXISTS trg_whatsapp_response_detection ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_response_detection
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'incoming')
  EXECUTE FUNCTION public.trigger_whatsapp_response_detection();
