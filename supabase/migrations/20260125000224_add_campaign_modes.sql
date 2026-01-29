-- Migration: Campaign Modes (Automatica, Semi-Automatica, Manual)
-- Description: Adds support for 3 campaign modes with templates and rate limiting
-- Date: 2026-01-25

-- ============================================
-- FASE 1: Adicionar campos à tabela campanhas
-- ============================================

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (campaign_type IN ('automatica', 'semi_automatica', 'manual')),
ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.copilot_agents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS auto_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.campanhas.campaign_type IS 'Tipo: automatica (IA), semi_automatica (templates), manual (kanban)';
COMMENT ON COLUMN public.campanhas.agent_id IS 'Agente Copilot vinculado (apenas para campanhas automaticas)';
COMMENT ON COLUMN public.campanhas.auto_config IS 'Config de automacao: delay_minutes, send_on_add_lead, working_hours_only, working_hours';

-- Index para busca por tipo
CREATE INDEX IF NOT EXISTS idx_campanhas_type ON public.campanhas(campaign_type);
CREATE INDEX IF NOT EXISTS idx_campanhas_agent ON public.campanhas(agent_id) WHERE agent_id IS NOT NULL;

-- ============================================
-- FASE 2: Tabela de Templates de Mensagem
-- ============================================

CREATE TABLE IF NOT EXISTS public.campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  content TEXT NOT NULL,

  -- Variáveis disponíveis no template
  available_variables TEXT[] DEFAULT ARRAY['nome', 'empresa', 'email', 'telefone', 'origem', 'segmento', 'faturamento'],

  -- Estatísticas
  times_used INTEGER DEFAULT 0,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_template_name_per_org UNIQUE (organization_id, name)
);

COMMENT ON TABLE public.campaign_templates IS 'Templates de mensagem para campanhas semi-automaticas';

-- ============================================
-- FASE 3: Vínculo Campanha-Templates (N:N)
-- ============================================

CREATE TABLE IF NOT EXISTS public.campanha_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.campaign_templates(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_template_per_campanha UNIQUE (campanha_id, template_id)
);

-- ============================================
-- FASE 4: Lotes de Disparo Agendado
-- ============================================

CREATE TABLE IF NOT EXISTS public.campaign_dispatch_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.campaign_templates(id) ON DELETE CASCADE,

  -- Agendamento
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),

  -- Filtro de leads (opcional)
  lead_filter JSONB DEFAULT NULL,

  -- Estatísticas
  total_leads INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,

  -- Auditoria
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.campaign_dispatch_batches IS 'Lotes de disparo agendados para campanhas semi-automaticas';

-- ============================================
-- FASE 5: Atualizar outbound_dispatch_log
-- ============================================

ALTER TABLE public.outbound_dispatch_log
ADD COLUMN IF NOT EXISTS campanha_id UUID REFERENCES public.campanhas(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.campaign_templates(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.campaign_dispatch_batches(id) ON DELETE SET NULL;

-- ============================================
-- FASE 6: Rate Limiting por Organização
-- ============================================

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS whatsapp_rate_limit JSONB DEFAULT '{
  "max_per_hour": 100,
  "max_per_day": 500,
  "delay_between_messages_ms": 2000
}'::jsonb;

COMMENT ON COLUMN public.organizations.whatsapp_rate_limit IS 'Limites de envio WhatsApp: max_per_hour, max_per_day, delay_between_messages_ms';

-- Tabela para tracking de rate limit
CREATE TABLE IF NOT EXISTS public.whatsapp_rate_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,

  hour_key TEXT NOT NULL, -- formato: YYYY-MM-DD-HH
  day_key TEXT NOT NULL,  -- formato: YYYY-MM-DD

  messages_this_hour INTEGER DEFAULT 0,
  messages_this_day INTEGER DEFAULT 0,

  last_message_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_rate_tracking UNIQUE (organization_id, instance_id, hour_key)
);

-- ============================================
-- FASE 7: Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_campaign_templates_org ON public.campaign_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_active ON public.campaign_templates(organization_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_campanha_templates_campanha ON public.campanha_templates(campanha_id);
CREATE INDEX IF NOT EXISTS idx_campanha_templates_template ON public.campanha_templates(template_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_batches_status ON public.campaign_dispatch_batches(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_batches_campanha ON public.campaign_dispatch_batches(campanha_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_log_campanha ON public.outbound_dispatch_log(campanha_id) WHERE campanha_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_log_batch ON public.outbound_dispatch_log(batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_tracking_org ON public.whatsapp_rate_tracking(organization_id, hour_key);

-- ============================================
-- FASE 8: RLS Policies
-- ============================================

ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_dispatch_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_rate_tracking ENABLE ROW LEVEL SECURITY;

-- Policies para campaign_templates
CREATE POLICY "Users can view org templates" ON public.campaign_templates FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can insert templates" ON public.campaign_templates FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    JOIN public.user_roles ur ON ur.user_id = tm.user_id
    WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
  ));

CREATE POLICY "Admins can update templates" ON public.campaign_templates FOR UPDATE
  USING (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    JOIN public.user_roles ur ON ur.user_id = tm.user_id
    WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
  ));

CREATE POLICY "Admins can delete templates" ON public.campaign_templates FOR DELETE
  USING (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    JOIN public.user_roles ur ON ur.user_id = tm.user_id
    WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- Policies para campanha_templates (usa mesma lógica de campanhas)
CREATE POLICY "Users can view campanha templates" ON public.campanha_templates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.campanhas c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE c.id = campanha_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage campanha templates" ON public.campanha_templates FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.campanhas c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    JOIN public.user_roles ur ON ur.user_id = tm.user_id
    WHERE c.id = campanha_id AND tm.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- Policies para dispatch_batches
CREATE POLICY "Users can view dispatch batches" ON public.campaign_dispatch_batches FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage dispatch batches" ON public.campaign_dispatch_batches FOR ALL
  USING (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    JOIN public.user_roles ur ON ur.user_id = tm.user_id
    WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- Policies para rate_tracking (apenas service role)
CREATE POLICY "Service role can manage rate tracking" ON public.whatsapp_rate_tracking FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- FASE 9: Trigger para disparo automático
-- ============================================

CREATE OR REPLACE FUNCTION trigger_campanha_lead_auto_dispatch()
RETURNS TRIGGER AS $$
DECLARE
  v_campanha RECORD;
  v_delay_minutes INTEGER;
  v_scheduled_at TIMESTAMPTZ;
BEGIN
  -- Buscar detalhes da campanha
  SELECT c.*, ca.id as agent_id, ca.is_active as agent_active, ca.whatsapp_instance_id
  INTO v_campanha
  FROM public.campanhas c
  LEFT JOIN public.copilot_agents ca ON ca.id = c.agent_id
  WHERE c.id = NEW.campanha_id;

  -- Apenas para campanhas AUTOMÁTICAS com agente ativo
  IF v_campanha.campaign_type = 'automatica'
     AND v_campanha.agent_id IS NOT NULL
     AND v_campanha.agent_active = true
     AND v_campanha.whatsapp_instance_id IS NOT NULL
  THEN
    -- Verificar se deve disparar ao adicionar lead
    IF (v_campanha.auto_config->>'send_on_add_lead')::boolean IS NOT FALSE THEN
      -- Calcular delay
      v_delay_minutes := COALESCE((v_campanha.auto_config->>'delay_minutes')::integer, 5);
      v_scheduled_at := NOW() + (v_delay_minutes || ' minutes')::interval;

      -- Verificar horário comercial se configurado
      IF (v_campanha.auto_config->>'working_hours_only')::boolean = true THEN
        DECLARE
          v_start_hour INTEGER;
          v_end_hour INTEGER;
          v_current_hour INTEGER;
        BEGIN
          v_start_hour := COALESCE((v_campanha.auto_config->'working_hours'->>'start')::time, '09:00'::time)::time;
          v_end_hour := COALESCE((v_campanha.auto_config->'working_hours'->>'end')::time, '18:00'::time)::time;
          v_current_hour := EXTRACT(HOUR FROM v_scheduled_at AT TIME ZONE 'America/Sao_Paulo');

          -- Se fora do horário, agendar para próximo dia útil às 9h
          IF v_current_hour < EXTRACT(HOUR FROM v_start_hour::time)
             OR v_current_hour >= EXTRACT(HOUR FROM v_end_hour::time) THEN
            v_scheduled_at := (DATE(v_scheduled_at AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '1 day' + v_start_hour::time)::timestamptz;
          END IF;
        END;
      END IF;

      -- Inserir no log de disparo
      INSERT INTO public.outbound_dispatch_log (
        organization_id,
        agent_id,
        lead_id,
        campanha_id,
        status,
        scheduled_at,
        trigger_reason,
        created_at
      ) VALUES (
        v_campanha.organization_id,
        v_campanha.agent_id,
        NEW.lead_id,
        NEW.campanha_id,
        'pending',
        v_scheduled_at,
        jsonb_build_object('trigger', 'campanha_lead_insert', 'stage_id', NEW.stage_id),
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger
DROP TRIGGER IF EXISTS on_campanha_lead_insert_auto_dispatch ON public.campanha_leads;
CREATE TRIGGER on_campanha_lead_insert_auto_dispatch
  AFTER INSERT ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_campanha_lead_auto_dispatch();

-- ============================================
-- FASE 10: Função para verificar rate limit
-- ============================================

CREATE OR REPLACE FUNCTION check_whatsapp_rate_limit(
  p_organization_id UUID,
  p_instance_id UUID DEFAULT NULL
)
RETURNS TABLE (
  can_send BOOLEAN,
  messages_this_hour INTEGER,
  messages_this_day INTEGER,
  max_per_hour INTEGER,
  max_per_day INTEGER,
  wait_seconds INTEGER
) AS $$
DECLARE
  v_rate_limit JSONB;
  v_tracking RECORD;
  v_hour_key TEXT;
  v_day_key TEXT;
  v_max_hour INTEGER;
  v_max_day INTEGER;
  v_delay_ms INTEGER;
BEGIN
  -- Buscar configuração de rate limit da org
  SELECT whatsapp_rate_limit INTO v_rate_limit
  FROM public.organizations
  WHERE id = p_organization_id;

  v_max_hour := COALESCE((v_rate_limit->>'max_per_hour')::integer, 100);
  v_max_day := COALESCE((v_rate_limit->>'max_per_day')::integer, 500);
  v_delay_ms := COALESCE((v_rate_limit->>'delay_between_messages_ms')::integer, 2000);

  -- Gerar chaves de tempo
  v_hour_key := TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD-HH24');
  v_day_key := TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');

  -- Buscar ou criar tracking
  SELECT * INTO v_tracking
  FROM public.whatsapp_rate_tracking
  WHERE organization_id = p_organization_id
    AND (instance_id = p_instance_id OR (instance_id IS NULL AND p_instance_id IS NULL))
    AND hour_key = v_hour_key;

  IF NOT FOUND THEN
    -- Criar novo tracking
    INSERT INTO public.whatsapp_rate_tracking (organization_id, instance_id, hour_key, day_key)
    VALUES (p_organization_id, p_instance_id, v_hour_key, v_day_key)
    RETURNING * INTO v_tracking;
  END IF;

  -- Verificar se pode enviar
  RETURN QUERY SELECT
    (v_tracking.messages_this_hour < v_max_hour AND v_tracking.messages_this_day < v_max_day) AS can_send,
    v_tracking.messages_this_hour,
    v_tracking.messages_this_day,
    v_max_hour,
    v_max_day,
    CASE
      WHEN v_tracking.last_message_at IS NOT NULL
           AND EXTRACT(EPOCH FROM (NOW() - v_tracking.last_message_at)) * 1000 < v_delay_ms
      THEN CEIL((v_delay_ms - EXTRACT(EPOCH FROM (NOW() - v_tracking.last_message_at)) * 1000) / 1000)::integer
      ELSE 0
    END AS wait_seconds;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FASE 11: Função para incrementar rate limit
-- ============================================

CREATE OR REPLACE FUNCTION increment_whatsapp_rate_limit(
  p_organization_id UUID,
  p_instance_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_hour_key TEXT;
  v_day_key TEXT;
BEGIN
  v_hour_key := TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD-HH24');
  v_day_key := TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');

  INSERT INTO public.whatsapp_rate_tracking (
    organization_id, instance_id, hour_key, day_key,
    messages_this_hour, messages_this_day, last_message_at
  )
  VALUES (
    p_organization_id, p_instance_id, v_hour_key, v_day_key,
    1, 1, NOW()
  )
  ON CONFLICT (organization_id, instance_id, hour_key)
  DO UPDATE SET
    messages_this_hour = whatsapp_rate_tracking.messages_this_hour + 1,
    messages_this_day = CASE
      WHEN whatsapp_rate_tracking.day_key = v_day_key
      THEN whatsapp_rate_tracking.messages_this_day + 1
      ELSE 1
    END,
    day_key = v_day_key,
    last_message_at = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FIM DA MIGRATION
-- ============================================
