-- Migration: Regras de envio por etapa para funis (pipe_whatsapp, pipe_confirmacao, pipe_propostas)
-- Espelha a estrutura de campanha_dispatch_rules para pipes, com adaptações:
-- - organization_id direto (ao invés de via campanha)
-- - pipe_type para identificar o funil
-- - pipeline_stage_id referencia pipeline_stages (não campanha_stages)
-- - scheduled_pipe_messages referencia pipe_record_id (id do registro no pipe)
-- Date: 2026-02-14

-- ============================================
-- 1. REGRAS DE ENVIO PARA PIPES
-- ============================================

CREATE TABLE IF NOT EXISTS public.pipe_dispatch_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipe_type TEXT NOT NULL CHECK (pipe_type IN ('whatsapp', 'confirmacao', 'propostas')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('lead_added', 'lead_moved_to_stage')),
  pipeline_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  whatsapp_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_pipe_stage_required CHECK (
    (trigger_type = 'lead_moved_to_stage' AND pipeline_stage_id IS NOT NULL)
    OR (trigger_type = 'lead_added' AND pipeline_stage_id IS NULL)
  )
);

COMMENT ON TABLE public.pipe_dispatch_rules IS 'Regras de envio para funis: ao adicionar lead ou mover para etapa, disparar sequência de mensagens.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipe_dispatch_rules_unique
  ON public.pipe_dispatch_rules(organization_id, pipe_type, trigger_type, COALESCE(pipeline_stage_id::text, ''));

CREATE INDEX IF NOT EXISTS idx_pipe_dispatch_rules_org_pipe ON public.pipe_dispatch_rules(organization_id, pipe_type);
CREATE INDEX IF NOT EXISTS idx_pipe_dispatch_rules_active ON public.pipe_dispatch_rules(organization_id, pipe_type, is_active) WHERE is_active = true;

-- ============================================
-- 2. PASSOS DA SEQUÊNCIA
-- ============================================

CREATE TABLE IF NOT EXISTS public.pipe_dispatch_rule_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.pipe_dispatch_rules(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'send_template'
    CHECK (action_type IN ('send_template', 'wait_response', 'change_stage', 'assign_sdr', 'cancel_sequence')),
  template_id UUID REFERENCES public.campaign_templates(id) ON DELETE CASCADE,
  delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  -- wait_response
  wait_timeout_minutes INTEGER DEFAULT 1440,
  timeout_action TEXT DEFAULT 'continue'
    CHECK (timeout_action IS NULL OR timeout_action IN ('continue', 'change_stage', 'send_template', 'cancel_sequence')),
  timeout_target_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  timeout_template_id UUID REFERENCES public.campaign_templates(id) ON DELETE SET NULL,
  -- change_stage
  target_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  -- assign_sdr
  sdr_assignment_mode TEXT DEFAULT 'specific'
    CHECK (sdr_assignment_mode IS NULL OR sdr_assignment_mode IN ('specific', 'round_robin')),
  target_sdr_id UUID,
  -- constraints
  CONSTRAINT chk_pipe_step_template_required CHECK (action_type != 'send_template' OR template_id IS NOT NULL),
  CONSTRAINT chk_pipe_step_stage_required CHECK (action_type != 'change_stage' OR target_stage_id IS NOT NULL)
);

COMMENT ON TABLE public.pipe_dispatch_rule_steps IS 'Passos da sequência de envio para funis.';

CREATE INDEX IF NOT EXISTS idx_pipe_dispatch_rule_steps_rule ON public.pipe_dispatch_rule_steps(rule_id);

-- ============================================
-- 3. FILA DE MENSAGENS AGENDADAS PARA PIPES
-- ============================================

CREATE TABLE IF NOT EXISTS public.scheduled_pipe_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipe_type TEXT NOT NULL CHECK (pipe_type IN ('whatsapp', 'confirmacao', 'propostas')),
  rule_id UUID NOT NULL REFERENCES public.pipe_dispatch_rules(id) ON DELETE CASCADE,
  pipe_record_id UUID NOT NULL,  -- ID do registro em pipe_whatsapp/pipe_confirmacao/pipe_propostas
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.campaign_templates(id) ON DELETE CASCADE,
  whatsapp_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled', 'waiting_response', 'response_received', 'timed_out', 'executed')),
  action_type TEXT NOT NULL DEFAULT 'send_template'
    CHECK (action_type IN ('send_template', 'wait_response', 'change_stage', 'assign_sdr', 'cancel_sequence')),
  step_position INTEGER,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  -- wait_response tracking
  waiting_since TIMESTAMPTZ,
  wait_timeout_at TIMESTAMPTZ,
  timeout_action TEXT,
  timeout_target_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  timeout_template_id UUID REFERENCES public.campaign_templates(id) ON DELETE SET NULL,
  -- change_stage / assign_sdr
  target_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  sdr_assignment_mode TEXT,
  target_sdr_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.scheduled_pipe_messages IS 'Fila de envios agendados pelas regras de funis.';

CREATE INDEX IF NOT EXISTS idx_scheduled_pipe_messages_worker
  ON public.scheduled_pipe_messages(status, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_scheduled_pipe_messages_org_pipe ON public.scheduled_pipe_messages(organization_id, pipe_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_pipe_messages_rule_record ON public.scheduled_pipe_messages(rule_id, pipe_record_id);

CREATE INDEX IF NOT EXISTS idx_spm_waiting_response_lead
  ON public.scheduled_pipe_messages(lead_id, status)
  WHERE status = 'waiting_response';

CREATE INDEX IF NOT EXISTS idx_spm_waiting_timeout
  ON public.scheduled_pipe_messages(status, wait_timeout_at)
  WHERE status = 'waiting_response';

-- ============================================
-- 4. RLS
-- ============================================

ALTER TABLE public.pipe_dispatch_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipe_dispatch_rule_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_pipe_messages ENABLE ROW LEVEL SECURITY;

-- pipe_dispatch_rules: via organization_id
DROP POLICY IF EXISTS "pipe_dispatch_rules_select" ON public.pipe_dispatch_rules;
CREATE POLICY "pipe_dispatch_rules_select"
  ON public.pipe_dispatch_rules FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_dispatch_rules_insert" ON public.pipe_dispatch_rules;
CREATE POLICY "pipe_dispatch_rules_insert"
  ON public.pipe_dispatch_rules FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_dispatch_rules_update" ON public.pipe_dispatch_rules;
CREATE POLICY "pipe_dispatch_rules_update"
  ON public.pipe_dispatch_rules FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_dispatch_rules_delete" ON public.pipe_dispatch_rules;
CREATE POLICY "pipe_dispatch_rules_delete"
  ON public.pipe_dispatch_rules FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- pipe_dispatch_rule_steps: via rule -> organization_id
DROP POLICY IF EXISTS "pipe_dispatch_rule_steps_select" ON public.pipe_dispatch_rule_steps;
CREATE POLICY "pipe_dispatch_rule_steps_select"
  ON public.pipe_dispatch_rule_steps FOR SELECT TO authenticated
  USING (
    rule_id IN (
      SELECT r.id FROM public.pipe_dispatch_rules r
      WHERE r.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "pipe_dispatch_rule_steps_insert" ON public.pipe_dispatch_rule_steps;
CREATE POLICY "pipe_dispatch_rule_steps_insert"
  ON public.pipe_dispatch_rule_steps FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND rule_id IN (
      SELECT r.id FROM public.pipe_dispatch_rules r
      WHERE r.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "pipe_dispatch_rule_steps_update" ON public.pipe_dispatch_rule_steps;
CREATE POLICY "pipe_dispatch_rule_steps_update"
  ON public.pipe_dispatch_rule_steps FOR UPDATE TO authenticated
  USING (
    rule_id IN (
      SELECT r.id FROM public.pipe_dispatch_rules r
      WHERE r.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "pipe_dispatch_rule_steps_delete" ON public.pipe_dispatch_rule_steps;
CREATE POLICY "pipe_dispatch_rule_steps_delete"
  ON public.pipe_dispatch_rule_steps FOR DELETE TO authenticated
  USING (
    rule_id IN (
      SELECT r.id FROM public.pipe_dispatch_rules r
      WHERE r.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- scheduled_pipe_messages: select para org; all para service_role
DROP POLICY IF EXISTS "scheduled_pipe_messages_select" ON public.scheduled_pipe_messages;
CREATE POLICY "scheduled_pipe_messages_select"
  ON public.scheduled_pipe_messages FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scheduled_pipe_messages_service_role" ON public.scheduled_pipe_messages;
CREATE POLICY "scheduled_pipe_messages_service_role"
  ON public.scheduled_pipe_messages FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 5. updated_at trigger para pipe_dispatch_rules
-- ============================================

CREATE OR REPLACE FUNCTION update_pipe_dispatch_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipe_dispatch_rules_updated_at ON public.pipe_dispatch_rules;
CREATE TRIGGER trg_pipe_dispatch_rules_updated_at
  BEFORE UPDATE ON public.pipe_dispatch_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_pipe_dispatch_rules_updated_at();

-- ============================================
-- 6. Função helper: agendar steps de pipe a partir de uma posição
-- ============================================

CREATE OR REPLACE FUNCTION public.schedule_pipe_rule_steps_from_position(
  p_organization_id UUID,
  p_pipe_type TEXT,
  p_rule_id UUID,
  p_pipe_record_id UUID,
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
    FROM public.pipe_dispatch_rule_steps
    WHERE rule_id = p_rule_id
      AND position >= p_from_position
    ORDER BY position
  LOOP
    cumul_minutes := cumul_minutes + step_rec.delay_minutes;
    sched_at := now() + (cumul_minutes || ' minutes')::interval;

    IF step_rec.action_type = 'send_template' THEN
      INSERT INTO public.scheduled_pipe_messages (
        organization_id, pipe_type, rule_id, pipe_record_id, lead_id, template_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position
      ) VALUES (
        p_organization_id, p_pipe_type, p_rule_id, p_pipe_record_id, p_lead_id, step_rec.template_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'send_template', step_rec.position
      );
      v_scheduled_any := true;

    ELSIF step_rec.action_type = 'wait_response' THEN
      INSERT INTO public.scheduled_pipe_messages (
        organization_id, pipe_type, rule_id, pipe_record_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position,
        waiting_since, wait_timeout_at,
        timeout_action, timeout_target_stage_id, timeout_template_id
      ) VALUES (
        p_organization_id, p_pipe_type, p_rule_id, p_pipe_record_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'wait_response', step_rec.position,
        NULL, NULL,
        step_rec.timeout_action, step_rec.timeout_target_stage_id, step_rec.timeout_template_id
      );
      v_scheduled_any := true;
      EXIT; -- barrier

    ELSIF step_rec.action_type = 'change_stage' THEN
      INSERT INTO public.scheduled_pipe_messages (
        organization_id, pipe_type, rule_id, pipe_record_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position,
        target_stage_id
      ) VALUES (
        p_organization_id, p_pipe_type, p_rule_id, p_pipe_record_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'change_stage', step_rec.position,
        step_rec.target_stage_id
      );
      v_scheduled_any := true;

    ELSIF step_rec.action_type = 'assign_sdr' THEN
      INSERT INTO public.scheduled_pipe_messages (
        organization_id, pipe_type, rule_id, pipe_record_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position,
        sdr_assignment_mode, target_sdr_id
      ) VALUES (
        p_organization_id, p_pipe_type, p_rule_id, p_pipe_record_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'assign_sdr', step_rec.position,
        step_rec.sdr_assignment_mode, step_rec.target_sdr_id
      );
      v_scheduled_any := true;

    ELSIF step_rec.action_type = 'cancel_sequence' THEN
      INSERT INTO public.scheduled_pipe_messages (
        organization_id, pipe_type, rule_id, pipe_record_id, lead_id,
        whatsapp_instance_id, scheduled_at, status, action_type, step_position
      ) VALUES (
        p_organization_id, p_pipe_type, p_rule_id, p_pipe_record_id, p_lead_id,
        p_whatsapp_instance_id, sched_at, 'scheduled', 'cancel_sequence', step_rec.position
      );
      v_scheduled_any := true;

    END IF;
  END LOOP;

  RETURN v_scheduled_any;
END;
$$;

-- ============================================
-- 7. Trigger function genérica para pipes
-- ============================================

CREATE OR REPLACE FUNCTION public.trigger_pipe_dispatch_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipe_type TEXT;
  r RECORD;
  v_org_id UUID;
  v_whatsapp_instance_id UUID;
  v_already_exists BOOLEAN;
  v_scheduled_any BOOLEAN := false;
  v_stage_id UUID;
  v_worker_url TEXT;
  v_secret_val TEXT;
BEGIN
  v_pipe_type := TG_ARGV[0];
  v_org_id := NEW.organization_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ON INSERT: buscar rules com trigger_type = 'lead_added'
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

  -- ON UPDATE of status: buscar rules com trigger_type = 'lead_moved_to_stage'
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Resolver pipeline_stage_id a partir do status (stage_key)
    SELECT id INTO v_stage_id
    FROM public.pipeline_stages
    WHERE organization_id = v_org_id
      AND pipeline_type = v_pipe_type
      AND stage_key = NEW.status::text
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
        -- Idempotency: não agendar se já existe para este registro+rule
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

COMMENT ON FUNCTION public.trigger_pipe_dispatch_rules IS 'Trigger genérico para pipe dispatch. Recebe pipe_type via TG_ARGV[0]. Resolve stage via pipeline_stages.stage_key.';

-- ============================================
-- 8. Triggers nos 3 pipes
-- ============================================

DROP TRIGGER IF EXISTS trg_pipe_whatsapp_dispatch ON public.pipe_whatsapp;
CREATE TRIGGER trg_pipe_whatsapp_dispatch
  AFTER INSERT OR UPDATE OF status ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('whatsapp');

DROP TRIGGER IF EXISTS trg_pipe_confirmacao_dispatch ON public.pipe_confirmacao;
CREATE TRIGGER trg_pipe_confirmacao_dispatch
  AFTER INSERT OR UPDATE OF status ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('confirmacao');

DROP TRIGGER IF EXISTS trg_pipe_propostas_dispatch ON public.pipe_propostas;
CREATE TRIGGER trg_pipe_propostas_dispatch
  AFTER INSERT OR UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('propostas');

-- ============================================
-- 9. Atualizar trigger de detecção de resposta para incluir pipes
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
  v_whatsapp_instance_id UUID;
  v_worker_url TEXT;
  v_secret_val TEXT;
  v_triggered_campaigns UUID[] := '{}';
  v_triggered_pipes TEXT[] := '{}';
  v_pipe_org_id UUID;
BEGIN
  IF NEW.direction != 'incoming' THEN
    RETURN NEW;
  END IF;

  -- 1. Check campaign waiting_response (existing logic)
  FOR waiting_rec IN
    SELECT scm.id, scm.campanha_id, scm.rule_id, scm.campanha_lead_id, scm.lead_id,
           scm.whatsapp_instance_id, scm.step_position
    FROM public.scheduled_campaign_messages scm
    WHERE scm.lead_id = NEW.lead_id
      AND scm.status = 'waiting_response'
  LOOP
    UPDATE public.scheduled_campaign_messages
    SET status = 'response_received', sent_at = now()
    WHERE id = waiting_rec.id;

    v_next_position := waiting_rec.step_position + 1;

    SELECT c.whatsapp_instance_id INTO v_whatsapp_instance_id
    FROM public.campanhas c WHERE c.id = waiting_rec.campanha_id;

    PERFORM public.schedule_rule_steps_from_position(
      waiting_rec.campanha_id, waiting_rec.rule_id, waiting_rec.campanha_lead_id,
      waiting_rec.lead_id,
      COALESCE(waiting_rec.whatsapp_instance_id, v_whatsapp_instance_id),
      v_next_position
    );

    IF NOT waiting_rec.campanha_id = ANY(v_triggered_campaigns) THEN
      v_triggered_campaigns := v_triggered_campaigns || waiting_rec.campanha_id;
    END IF;
  END LOOP;

  -- Dispatch campaign worker
  IF array_length(v_triggered_campaigns, 1) > 0 THEN
    BEGIN
      SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
      SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
      IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
        FOR i IN 1..array_length(v_triggered_campaigns, 1) LOOP
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', COALESCE(v_secret_val, '')),
            body := jsonb_build_object('campanha_id', v_triggered_campaigns[i]::text)
          );
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- 2. Check pipe waiting_response (new logic)
  FOR waiting_rec IN
    SELECT spm.id, spm.organization_id, spm.pipe_type, spm.rule_id, spm.pipe_record_id,
           spm.lead_id, spm.whatsapp_instance_id, spm.step_position
    FROM public.scheduled_pipe_messages spm
    WHERE spm.lead_id = NEW.lead_id
      AND spm.status = 'waiting_response'
  LOOP
    UPDATE public.scheduled_pipe_messages
    SET status = 'response_received', sent_at = now()
    WHERE id = waiting_rec.id;

    v_next_position := waiting_rec.step_position + 1;

    PERFORM public.schedule_pipe_rule_steps_from_position(
      waiting_rec.organization_id, waiting_rec.pipe_type,
      waiting_rec.rule_id, waiting_rec.pipe_record_id, waiting_rec.lead_id,
      waiting_rec.whatsapp_instance_id,
      v_next_position
    );

    -- Track triggered pipe for notification
    IF NOT (waiting_rec.pipe_type || ':' || waiting_rec.organization_id::text) = ANY(v_triggered_pipes) THEN
      v_triggered_pipes := v_triggered_pipes || (waiting_rec.pipe_type || ':' || waiting_rec.organization_id::text);
    END IF;
  END LOOP;

  -- Dispatch pipe worker
  IF array_length(v_triggered_pipes, 1) > 0 THEN
    BEGIN
      SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
      SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
      IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
        FOR i IN 1..array_length(v_triggered_pipes, 1) LOOP
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', COALESCE(v_secret_val, '')),
            body := jsonb_build_object(
              'pipe_type', split_part(v_triggered_pipes[i], ':', 1),
              'organization_id', split_part(v_triggered_pipes[i], ':', 2)
            )
          );
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (same as before)
DROP TRIGGER IF EXISTS trg_whatsapp_response_detection ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_response_detection
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'incoming')
  EXECUTE FUNCTION public.trigger_whatsapp_response_detection();
